import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelemetryService } from "@/telemetry/service";

import { TestSink } from "../../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type * as vscode from "vscode";

import type { TelemetrySink } from "@/telemetry/event";

function fakeContext(): vscode.ExtensionContext {
	return {
		extension: { packageJSON: { version: "1.2.3-test" } },
	} as unknown as vscode.ExtensionContext;
}

interface Harness {
	service: TelemetryService;
	sink: TestSink;
	config: MockConfigurationProvider;
}

function makeHarness(level: "off" | "local" = "local"): Harness {
	const config = new MockConfigurationProvider();
	config.set("coder.telemetry.level", level);
	const sink = new TestSink();
	const service = new TelemetryService(
		fakeContext(),
		[sink],
		createMockLogger(),
	);
	return { service, sink, config };
}

function makeService(sinks: TelemetrySink[]): TelemetryService {
	new MockConfigurationProvider().set("coder.telemetry.level", "local");
	return new TelemetryService(fakeContext(), sinks, createMockLogger());
}

describe("TelemetryService", () => {
	let h: Harness;
	beforeEach(() => {
		h = makeHarness();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	describe("log", () => {
		it("emits an event with auto-injected context, properties, and measurements", () => {
			h.service.log("activation", { outcome: "success" }, { latencyMs: 12 });

			const [event] = h.sink.events;
			expect(event).toMatchObject({
				eventName: "activation",
				eventSequence: 0,
				properties: { outcome: "success" },
				measurements: { latencyMs: 12 },
				context: {
					extensionVersion: "1.2.3-test",
					machineId: "test-machine-id",
					sessionId: "test-session-id",
					deploymentUrl: "",
				},
			});
			expect(event.eventId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
			expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("emits unique eventIds and monotonic eventSequence", () => {
			h.service.log("a");
			h.service.log("b");
			h.service.log("c");

			expect(new Set(h.sink.events.map((e) => e.eventId)).size).toBe(3);
			expect(h.sink.events.map((e) => e.eventSequence)).toEqual([0, 1, 2]);
		});
	});

	describe("logError", () => {
		it("attaches the normalized error block to the event", () => {
			h.service.logError("activation", new TypeError("nope"), {
				phase: "init",
			});

			expect(h.sink.events[0]).toMatchObject({
				properties: { phase: "init" },
				error: { message: "nope", type: "TypeError" },
			});
		});
	});

	describe("trace", () => {
		it("returns the wrapped value and records durationMs on success", async () => {
			vi.useFakeTimers();
			const promise = h.service.trace(
				"activation",
				async () => {
					await new Promise((r) => setTimeout(r, 250));
					return 42;
				},
				{ phase: "init" },
			);
			await vi.advanceTimersByTimeAsync(250);

			expect(await promise).toBe(42);
			expect(h.sink.events[0]).toMatchObject({
				properties: { phase: "init", result: "success" },
			});
			expect(h.sink.events[0].measurements.durationMs).toBeCloseTo(250, 0);
		});

		it("emits an error event with the cause and rethrows on failure", async () => {
			const err = new Error("boom");
			await expect(
				h.service.trace("activation", () => Promise.reject(err)),
			).rejects.toBe(err);

			expect(h.sink.events[0]).toMatchObject({
				properties: { result: "error" },
				error: { message: "boom" },
			});
		});

		it("forwards caller measurements alongside the framework-set durationMs", async () => {
			await h.service.trace(
				"auth.token_refresh",
				() => Promise.resolve(),
				{},
				{ attempts: 2 },
			);

			const [event] = h.sink.events;
			expect(event.measurements.attempts).toBe(2);
			expect(event.measurements.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("flat traces (no phases) emit a single event with a fresh traceId", async () => {
			await h.service.trace("a", () => Promise.resolve(1));
			await h.service.trace("b", () => Promise.resolve(2));

			const [a, b] = h.sink.events;
			expect(a.traceId).toBeDefined();
			expect(b.traceId).toBeDefined();
			expect(a.traceId).not.toBe(b.traceId);
			expect(a.parentEventId).toBeUndefined();
			expect(b.parentEventId).toBeUndefined();
		});

		it("parent and child phase events share one traceId on success", async () => {
			const result = await h.service.trace("remote.setup", async (span) => {
				await span.phase("workspace_lookup", () => Promise.resolve("ws"));
				await span.phase("ssh_config", () => Promise.resolve("cfg"));
				return "done";
			});

			expect(result).toBe("done");
			const [phase1, phase2, parent] = h.sink.events;
			expect(phase1.eventName).toBe("remote.setup.workspace_lookup");
			expect(phase2.eventName).toBe("remote.setup.ssh_config");
			expect(parent).toMatchObject({
				eventName: "remote.setup",
				properties: { result: "success" },
			});
			expect(parent.traceId).toBeDefined();
			expect(phase1.traceId).toBe(parent.traceId);
			expect(phase2.traceId).toBe(parent.traceId);
		});

		it("phase children carry parentEventId pointing at the parent's eventId; logs do not", async () => {
			h.service.log("plain");
			await h.service.trace("op", async (span) => {
				await span.phase("p1", () => Promise.resolve());
				await span.phase("p2", () => Promise.resolve());
			});

			const [plain, p1, p2, parent] = h.sink.events;
			// log/logError/time events have no parentEventId field.
			expect(plain.parentEventId).toBeUndefined();
			// Parent (root) has no parentEventId either.
			expect(parent.parentEventId).toBeUndefined();
			// Phase children point at the parent's eventId.
			expect(p1.parentEventId).toBe(parent.eventId);
			expect(p2.parentEventId).toBe(parent.eventId);
			// All eventIds are still globally unique.
			expect(
				new Set([plain.eventId, p1.eventId, p2.eventId, parent.eventId]).size,
			).toBe(4);
		});

		it("phase eventName composes as '<parent>.<phaseName>' and records durationMs", async () => {
			await h.service.trace("remote.setup", async (span) => {
				await span.phase("workspace_lookup", () => Promise.resolve("ws"));
			});

			const [phase] = h.sink.events;
			expect(phase.eventName).toBe("remote.setup.workspace_lookup");
			expect(phase.measurements.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("supports grandchildren via the child span's phase method", async () => {
			await h.service.trace("remote.setup", async (span) => {
				await span.phase("workspace_lookup", async (childSpan) => {
					await childSpan.phase("dns_resolve", () => Promise.resolve());
				});
			});

			const [grandchild, child, parent] = h.sink.events;
			expect(parent.eventName).toBe("remote.setup");
			expect(child.eventName).toBe("remote.setup.workspace_lookup");
			expect(grandchild.eventName).toBe(
				"remote.setup.workspace_lookup.dns_resolve",
			);
			// All three share one traceId.
			expect(child.traceId).toBe(parent.traceId);
			expect(grandchild.traceId).toBe(parent.traceId);
			// Hierarchy via parentEventId.
			expect(parent.parentEventId).toBeUndefined();
			expect(child.parentEventId).toBe(parent.eventId);
			expect(grandchild.parentEventId).toBe(child.eventId);
		});

		it("phase forwards caller properties unchanged except for the framework-set result", async () => {
			await h.service.trace("op", async (span) => {
				await span.phase("p", () => Promise.resolve(0), { extra: "yes" });
			});

			const [phase] = h.sink.events;
			expect(phase.properties).toEqual({
				extra: "yes",
				result: "success",
			});
		});

		it("phase emits error event with cause and rethrows on failure", async () => {
			const boom = new Error("nope");
			await expect(
				h.service.trace("op", async (span) => {
					await span.phase("p", () => Promise.reject(boom));
				}),
			).rejects.toBe(boom);

			const [phase] = h.sink.events;
			expect(phase).toMatchObject({
				eventName: "op.p",
				properties: { result: "error" },
				error: { message: "nope" },
			});
		});

		it("phase with a name containing '.' is sanitized and the call succeeds", async () => {
			await h.service.trace("op", async (span) => {
				await span.phase("bad.name", () => Promise.resolve());
			});

			const [phase] = h.sink.events;
			expect(phase.eventName).toBe("op.bad_name");
		});

		it("on phase failure: completed phases emit success, parent emits an error summary, error rethrown, later phases never run", async () => {
			const boom = new Error("phase-2-broke");

			await expect(
				h.service.trace("remote.setup", async (span) => {
					await span.phase("ok_phase", () => Promise.resolve("ok"));
					await span.phase("bad_phase", () => Promise.reject(boom));
					await span.phase("never_runs", () => Promise.resolve("x"));
				}),
			).rejects.toBe(boom);

			expect(h.sink.events).toHaveLength(3);
			const [okPhase, badPhase, parent] = h.sink.events;
			expect(okPhase.eventName).toBe("remote.setup.ok_phase");
			expect(okPhase.properties).toMatchObject({ result: "success" });
			expect(badPhase.eventName).toBe("remote.setup.bad_phase");
			expect(badPhase.properties).toMatchObject({ result: "error" });
			expect(parent).toMatchObject({
				eventName: "remote.setup",
				properties: { result: "error" },
				error: { message: "phase-2-broke" },
			});
			expect(
				[okPhase, badPhase, parent].every((e) => e.traceId === parent.traceId),
			).toBe(true);
		});
	});

	describe("setDeploymentUrl", () => {
		it("propagates to subsequent events and can be reset", () => {
			h.service.log("a");
			h.service.setDeploymentUrl("https://coder.example.com");
			h.service.log("b");
			h.service.setDeploymentUrl("");
			h.service.log("c");

			expect(h.sink.events.map((e) => e.context.deploymentUrl)).toEqual([
				"",
				"https://coder.example.com",
				"",
			]);
		});

		it("captures the URL as of the moment each event in a trace is emitted", async () => {
			await h.service.trace("op", async (span) => {
				await span.phase("first", () => Promise.resolve(""));
				h.service.setDeploymentUrl("https://coder.example.com");
				await span.phase("second", () => Promise.resolve(""));
			});

			const [first, second, parent] = h.sink.events;
			expect(first.context.deploymentUrl).toBe("");
			expect(second.context.deploymentUrl).toBe("https://coder.example.com");
			expect(parent.context.deploymentUrl).toBe("https://coder.example.com");
		});
	});

	describe("level off", () => {
		beforeEach(() => {
			h = makeHarness("off");
		});

		it("suppresses emissions but still runs wrapped fns for trace", async () => {
			h.service.log("a");
			h.service.logError("b", new Error("ignored"));

			expect(await h.service.trace("c", () => Promise.resolve(42))).toBe(42);

			const traceResult = await h.service.trace("d", async (span) => {
				const phaseValue = await span.phase("p", () =>
					Promise.resolve("inner"),
				);
				expect(phaseValue).toBe("inner");
				return "outer";
			});
			expect(traceResult).toBe("outer");

			expect(h.sink.events).toHaveLength(0);
		});
	});

	describe("reactive level", () => {
		it("local → off flushes sinks and suppresses; off → local resumes", () => {
			h.service.log("first");
			expect(h.sink.events).toHaveLength(1);

			h.config.set("coder.telemetry.level", "off");
			expect(h.sink.flush).toHaveBeenCalledTimes(1);

			h.service.log("second");
			expect(h.sink.events).toHaveLength(1);

			h.config.set("coder.telemetry.level", "local");
			h.service.log("third");
			expect(h.sink.events).toHaveLength(2);
		});

		it("treats unknown values (e.g. future deployment) as local", () => {
			h = makeHarness("off");
			h.config.set("coder.telemetry.level", "deployment");
			h.service.log("evt");
			expect(h.sink.events).toHaveLength(1);
		});
	});

	describe("multiple sinks", () => {
		it("a throwing sink does not block other sinks from receiving events", () => {
			const bad: TelemetrySink = {
				name: "bad",
				minLevel: "local",
				write: () => {
					throw new Error("boom");
				},
				flush: () => Promise.resolve(),
				dispose: () => Promise.resolve(),
			};
			const good = new TestSink("good");
			const service = makeService([bad, good]);

			service.log("activation");
			expect(good.events).toHaveLength(1);
		});
	});

	describe("errors never propagate to the caller", () => {
		const throwingSink: TelemetrySink = {
			name: "throws",
			minLevel: "local",
			write: () => {
				throw new Error("sink write failed");
			},
			flush: () => Promise.resolve(),
			dispose: () => Promise.resolve(),
		};

		it("log/logError do not throw when the only sink throws", () => {
			const service = makeService([throwingSink]);
			expect(() => service.log("a")).not.toThrow();
			expect(() =>
				service.logError("b", new Error("user-error")),
			).not.toThrow();
		});

		it("trace returns the user fn's value when the sink throws", async () => {
			const service = makeService([throwingSink]);
			await expect(
				service.trace("op", () => Promise.resolve(42)),
			).resolves.toBe(42);
		});

		it("trace rethrows the user fn's error (not any telemetry error)", async () => {
			const service = makeService([throwingSink]);
			const userErr = new Error("user-error");
			await expect(
				service.trace("op", () => Promise.reject(userErr)),
			).rejects.toBe(userErr);
		});

		it("trace and span.phase complete normally when the sink throws", async () => {
			const service = makeService([throwingSink]);
			const result = await service.trace("op", async (span) => {
				const phaseValue = await span.phase("p", () =>
					Promise.resolve("phase"),
				);
				expect(phaseValue).toBe("phase");
				return "trace";
			});
			expect(result).toBe("trace");
		});
	});

	describe("dispose", () => {
		it("flushes and disposes every sink", async () => {
			await h.service.dispose();
			expect(h.sink.flush).toHaveBeenCalledTimes(1);
			expect(h.sink.dispose).toHaveBeenCalledTimes(1);
		});

		it("unsubscribes the config watcher so later level changes are ignored", async () => {
			await h.service.dispose();
			h.sink.flush.mockClear();

			h.config.set("coder.telemetry.level", "off");
			expect(h.sink.flush).not.toHaveBeenCalled();
		});

		it("resolves even when sinks reject in flush or dispose", async () => {
			const bad: TelemetrySink = {
				name: "bad",
				minLevel: "local",
				write: () => {},
				flush: () => Promise.reject(new Error("flush fail")),
				dispose: () => Promise.reject(new Error("dispose fail")),
			};
			const good = new TestSink("good");
			const service = makeService([bad, good]);

			await expect(service.dispose()).resolves.toBeUndefined();
			expect(good.flush).toHaveBeenCalled();
			expect(good.dispose).toHaveBeenCalled();
		});
	});
});
