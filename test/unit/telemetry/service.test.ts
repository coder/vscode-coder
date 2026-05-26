import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSession, type TelemetrySink } from "@/telemetry/event";
import { TelemetryService } from "@/telemetry/service";

import { TestSink } from "../../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { Logger } from "@/logging/logger";
import type { Span } from "@/telemetry/span";

const TEST_VERSION = "1.2.3-test";
const TEST_SESSION_ID = "test-session";

const testSession = () => buildSession(TEST_VERSION, TEST_SESSION_ID);

interface Harness {
	service: TelemetryService;
	sink: TestSink;
	config: MockConfigurationProvider;
	logger: Logger;
}

function makeHarness(level: "off" | "local" = "local"): Harness {
	const config = new MockConfigurationProvider();
	config.set("coder.telemetry.level", level);
	const sink = new TestSink();
	const logger = createMockLogger();
	const service = new TelemetryService(testSession(), [sink], logger);
	return { service, sink, config, logger };
}

function makeService(sinks: TelemetrySink[]): TelemetryService {
	new MockConfigurationProvider().set("coder.telemetry.level", "local");
	return new TelemetryService(testSession(), sinks, createMockLogger());
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
					sessionId: TEST_SESSION_ID,
					deploymentUrl: "",
				},
			});
			expect(event.eventId).toMatch(/^[0-9a-f]{16}$/);
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

	it("top-level log/logError emit no traceId or parentEventId", () => {
		h.service.log("plain");
		h.service.logError("plain.error", new Error("nope"));

		const [log, logError] = h.sink.events;
		expect(log.traceId).toBeUndefined();
		expect(log.parentEventId).toBeUndefined();
		expect(logError.traceId).toBeUndefined();
		expect(logError.parentEventId).toBeUndefined();
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
			await h.service.trace("op", () => Promise.resolve(), {}, { attempts: 2 });

			const [event] = h.sink.events;
			expect(event.measurements.attempts).toBe(2);
			expect(event.measurements.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("does not observe later caller object mutations", async () => {
			const properties = { phase: "start" };
			const measurements = { attempts: 1 };

			await h.service.trace(
				"op",
				() => {
					properties.phase = "changed";
					measurements.attempts = 2;
					return Promise.resolve();
				},
				properties,
				measurements,
			);

			expect(h.sink.events[0]).toMatchObject({
				properties: { phase: "start", result: "success" },
				measurements: { attempts: 1 },
			});
		});

		it("lets spans set properties and measurements before emit", async () => {
			await h.service.trace("cli.download", (span) => {
				span.setProperty("reason", "missing");
				span.setMeasurement("downloadedBytes", 123);
				return Promise.resolve();
			});

			expect(h.sink.events[0]).toMatchObject({
				properties: { reason: "missing", result: "success" },
				measurements: { downloadedBytes: 123 },
			});
		});

		it("span.log emits with the span's traceId and parentEventId", async () => {
			await h.service.trace("op", (span) => {
				span.log("checkpoint", { ready: true }, { count: 1 });
				return Promise.resolve();
			});

			const [log, parent] = h.sink.events;
			expect(log).toMatchObject({
				eventName: "op.checkpoint",
				properties: { ready: "true" },
				measurements: { count: 1 },
			});
			expect(log.eventId).not.toBe(parent.eventId);
			expect(log.traceId).toBe(parent.traceId);
			expect(log.parentEventId).toBe(parent.eventId);
			expect(log.properties.result).toBeUndefined();
			expect(log.measurements.durationMs).toBeUndefined();
		});

		it("span.logError emits with traceId, parentEventId, and the error block", async () => {
			await h.service.trace("op", (span) => {
				span.logError(
					"failed",
					new TypeError("nope"),
					{ attempt: 1 },
					{ retries: 2 },
				);
				return Promise.resolve();
			});

			const [log, parent] = h.sink.events;
			expect(log).toMatchObject({
				eventName: "op.failed",
				properties: { attempt: "1" },
				measurements: { retries: 2 },
				error: { message: "nope", type: "TypeError" },
			});
			expect(log.traceId).toBe(parent.traceId);
			expect(log.parentEventId).toBe(parent.eventId);
			expect(log.measurements.durationMs).toBeUndefined();
		});

		it("child span logs point at the child span", async () => {
			await h.service.trace("op", async (span) => {
				await span.phase("phase", (childSpan) => {
					childSpan.log("checkpoint", { ready: true }, { count: 1 });
					childSpan.logError(
						"oops",
						new Error("boom"),
						{ attempt: 2 },
						{ retries: 3 },
					);
					return Promise.resolve();
				});
			});

			const [log, logError, child, parent] = h.sink.events;
			expect(log.eventName).toBe("op.phase.checkpoint");
			expect(log.traceId).toBe(parent.traceId);
			expect(log.parentEventId).toBe(child.eventId);
			expect(log.properties.ready).toBe("true");
			expect(log.measurements.count).toBe(1);
			expect(logError.eventName).toBe("op.phase.oops");
			expect(logError.traceId).toBe(parent.traceId);
			expect(logError.parentEventId).toBe(child.eventId);
			expect(logError.error).toMatchObject({ message: "boom" });
			expect(logError.properties.attempt).toBe("2");
			expect(logError.measurements.retries).toBe(3);
			expect(child.parentEventId).toBe(parent.eventId);
		});

		it("span log names containing '.' are sanitized like phase names", async () => {
			await h.service.trace("op", (span) => {
				span.log("bad.name");
				return Promise.resolve();
			});

			const [log] = h.sink.events;
			expect(log.eventName).toBe("op.bad_name");
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

		it("phase children carry parentEventId pointing at the parent's eventId; top-level logs do not", async () => {
			h.service.log("plain");
			await h.service.trace("op", async (span) => {
				await span.phase("p1", () => Promise.resolve());
				await span.phase("p2", () => Promise.resolve());
			});

			const [plain, p1, p2, parent] = h.sink.events;
			// Top-level log/logError events have no parentEventId field.
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

		it("drops setProperty/setMeasurement/markAborted/markFailure called after emit", async () => {
			let escapedSpan: Span | undefined;
			await h.service.trace("op", (span) => {
				escapedSpan = span;
				return Promise.resolve();
			});

			expect(h.sink.events).toHaveLength(1);

			escapedSpan?.setProperty("late", "ignored");
			escapedSpan?.setMeasurement("lateMs", 99);
			escapedSpan?.markAborted();
			escapedSpan?.markFailure();

			expect(h.sink.events[0].properties.late).toBeUndefined();
			expect(h.sink.events[0].measurements.lateMs).toBeUndefined();
			expect(h.sink.events[0].properties.result).toBe("success");
		});

		it("drops span logs called after emit", async () => {
			let escapedSpan: Span | undefined;
			await h.service.trace("op", (span) => {
				escapedSpan = span;
				return Promise.resolve();
			});

			escapedSpan?.log("late");
			escapedSpan?.logError("late_error", new Error("ignored"));

			expect(h.sink.events).toHaveLength(1);
		});

		it("runs phase fns called after emit but emits no phase event", async () => {
			let escapedSpan: Span | undefined;
			await h.service.trace("op", (span) => {
				escapedSpan = span;
				return Promise.resolve();
			});

			const result = await escapedSpan?.phase("late", (childSpan) => {
				childSpan.log("ignored");
				return Promise.resolve("ran");
			});

			expect(result).toBe("ran");
			expect(h.sink.events).toHaveLength(1);
		});

		it("warns once per post-emit method call", async () => {
			let escapedSpan: Span | undefined;
			await h.service.trace("op", (span) => {
				escapedSpan = span;
				return Promise.resolve();
			});

			const warnBefore = vi.mocked(h.logger.warn).mock.calls.length;
			escapedSpan?.setProperty("late", "ignored");
			escapedSpan?.setMeasurement("lateMs", 99);
			escapedSpan?.markAborted();
			escapedSpan?.markFailure();
			escapedSpan?.log("late_log");
			escapedSpan?.logError("late_log_error", new Error("ignored"));
			await escapedSpan?.phase("late_phase", () => Promise.resolve());

			expect(vi.mocked(h.logger.warn).mock.calls.length).toBe(warnBefore + 7);
		});

		it("markAborted flips result to 'aborted' on normal return", async () => {
			await h.service.trace("op", (span) => {
				span.markAborted();
				return Promise.resolve();
			});

			expect(h.sink.events[0]).toMatchObject({
				eventName: "op",
				properties: { result: "aborted" },
			});
		});

		it("markAborted does not override 'error' when the span throws", async () => {
			const boom = new Error("kaboom");
			await expect(
				h.service.trace("op", (span) => {
					span.markAborted();
					return Promise.reject(boom);
				}),
			).rejects.toBe(boom);

			expect(h.sink.events[0]).toMatchObject({
				eventName: "op",
				properties: { result: "error" },
				error: { message: "kaboom" },
			});
		});

		it("markFailure flips result to 'error' on normal return without an error block", async () => {
			await h.service.trace("op", (span) => {
				span.markFailure();
				return Promise.resolve();
			});

			expect(h.sink.events[0]).toMatchObject({
				eventName: "op",
				properties: { result: "error" },
			});
			expect(h.sink.events[0].error).toBeUndefined();
		});

		it("markFailure overrides markAborted (failure wins over abort)", async () => {
			await h.service.trace("op", (span) => {
				span.markAborted();
				span.markFailure();
				return Promise.resolve();
			});

			expect(h.sink.events[0].properties.result).toBe("error");
		});

		it("thrown errors take precedence over markFailure (error block is preserved)", async () => {
			const boom = new Error("kaboom");
			await expect(
				h.service.trace("op", (span) => {
					span.markFailure();
					return Promise.reject(boom);
				}),
			).rejects.toBe(boom);

			expect(h.sink.events[0]).toMatchObject({
				eventName: "op",
				properties: { result: "error" },
				error: { message: "kaboom" },
			});
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

			expect(
				await h.service.trace("c", (span) => {
					span.log("ignored");
					span.logError("ignored_error", new Error("ignored"));
					return Promise.resolve(42);
				}),
			).toBe(42);

			const traceResult = await h.service.trace("d", async (span) => {
				const phaseValue = await span.phase("p", (childSpan) => {
					childSpan.log("ignored");
					childSpan.logError("ignored_error", new Error("ignored"));
					return Promise.resolve("inner");
				});
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

		it("a mid-trace level → off does not orphan child phases or drop the parent", async () => {
			let toggled = false;
			await h.service.trace("op", async (span) => {
				await span.phase("p1", () => Promise.resolve());
				if (!toggled) {
					h.config.set("coder.telemetry.level", "off");
					toggled = true;
				}
				await span.phase("p2", () => Promise.resolve());
			});

			expect(h.sink.events).toHaveLength(3);
			const [p1, p2, parent] = h.sink.events;
			expect(p1.eventName).toBe("op.p1");
			expect(p2.eventName).toBe("op.p2");
			expect(parent.eventName).toBe("op");
			expect(p1.traceId).toBe(parent.traceId);
			expect(p2.traceId).toBe(parent.traceId);
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
				span.log("checkpoint");
				span.logError("failure", new Error("telemetry-error"));
				const phaseValue = await span.phase("p", (childSpan) => {
					childSpan.log("checkpoint");
					return Promise.resolve("phase");
				});
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

	describe("getContext", () => {
		it("returns the session plus the current deploymentUrl", () => {
			h.service.setDeploymentUrl("https://coder.example.com");
			expect(h.service.getContext()).toEqual({
				extensionVersion: "1.2.3-test",
				machineId: "test-machine-id",
				sessionId: TEST_SESSION_ID,
				osType: expect.any(String),
				osVersion: expect.any(String),
				hostArch: expect.any(String),
				platformName: expect.any(String),
				platformVersion: expect.any(String),
				deploymentUrl: "https://coder.example.com",
			});
		});

		it("matches the context attached to emitted events", () => {
			h.service.setDeploymentUrl("https://coder.example.com");
			h.service.log("activation");
			expect(h.service.getContext()).toEqual(h.sink.events[0].context);
		});

		it("returns a fresh object each call so callers can't mutate internal state", () => {
			const a = h.service.getContext();
			const b = h.service.getContext();
			expect(a).not.toBe(b);
			expect(a).toEqual(b);
		});

		it("reflects setDeploymentUrl changes between calls", () => {
			h.service.setDeploymentUrl("a");
			expect(h.service.getContext().deploymentUrl).toBe("a");
			h.service.setDeploymentUrl("b");
			expect(h.service.getContext().deploymentUrl).toBe("b");
		});
	});

	describe("flush", () => {
		it("flushes every sink", async () => {
			const second = new TestSink("second");
			const service = makeService([h.sink, second]);

			await service.flush();

			expect(h.sink.flush).toHaveBeenCalledTimes(1);
			expect(second.flush).toHaveBeenCalledTimes(1);
		});

		it("resolves even when a sink rejects", async () => {
			const bad: TelemetrySink = {
				name: "bad",
				minLevel: "local",
				write: () => {},
				flush: () => Promise.reject(new Error("flush failed")),
				dispose: () => Promise.resolve(),
			};
			const good = new TestSink("good");
			const service = makeService([bad, good]);

			await expect(service.flush()).resolves.toBeUndefined();
			expect(good.flush).toHaveBeenCalled();
		});

		it("does not dispose sinks", async () => {
			await h.service.flush();
			expect(h.sink.dispose).not.toHaveBeenCalled();
		});
	});
});
