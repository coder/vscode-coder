import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelemetryService } from "@/telemetry/service";

import { TestSink } from "../../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type * as vscode from "vscode";

import type { Logger } from "@/logging/logger";
import type { TelemetrySink } from "@/telemetry/event";

function fakeContext(): vscode.ExtensionContext {
	return {
		extension: { packageJSON: { version: "1.2.3-test" } },
	} as unknown as vscode.ExtensionContext;
}

interface Harness {
	service: TelemetryService;
	sink: TestSink;
	logger: Logger;
	config: MockConfigurationProvider;
}

function makeHarness(level: "off" | "local" = "local"): Harness {
	const config = new MockConfigurationProvider();
	config.set("coder.telemetry.level", level);
	const logger = createMockLogger();
	const sink = new TestSink();
	const service = new TelemetryService(fakeContext(), [sink], logger);
	return { service, sink, logger, config };
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
			h.service.log("activation", { result: "success" }, { durationMs: 12 });

			expect(h.sink.events).toHaveLength(1);
			const event = h.sink.events[0];
			expect(event).toMatchObject({
				eventName: "activation",
				eventSequence: 0,
				properties: { result: "success" },
				measurements: { durationMs: 12 },
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

		it("issues unique eventIds and monotonic eventSequence per emission", () => {
			h.service.log("a");
			h.service.log("b");
			h.service.log("c");

			const ids = h.sink.events.map((e) => e.eventId);
			expect(new Set(ids).size).toBe(3);
			expect(h.sink.events.map((e) => e.eventSequence)).toEqual([0, 1, 2]);
		});

		it("defaults properties and measurements to empty objects", () => {
			h.service.log("nothing");
			expect(h.sink.events[0].properties).toEqual({});
			expect(h.sink.events[0].measurements).toEqual({});
		});
	});

	describe("logError", () => {
		it("attaches the error block to the event", () => {
			h.service.logError("activation", new TypeError("nope"), {
				phase: "init",
			});

			expect(h.sink.events[0]).toMatchObject({
				properties: { phase: "init" },
				error: { message: "nope", type: "TypeError" },
			});
		});
	});

	describe("time", () => {
		it("returns the wrapped value and emits a success event with durationMs", async () => {
			vi.useFakeTimers();
			const promise = h.service.time(
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

		it("emits an error event and rethrows on failure", async () => {
			const err = new Error("boom");
			await expect(
				h.service.time("activation", () => Promise.reject(err)),
			).rejects.toBe(err);

			expect(h.sink.events[0]).toMatchObject({
				properties: { result: "error" },
				error: { message: "boom" },
			});
		});
	});

	describe("trace", () => {
		it("parent and child phase events share one traceId on success", async () => {
			const result = await h.service.trace("remote.setup", async (trace) => {
				await trace.phase("workspace_lookup", () => Promise.resolve("ws"));
				await trace.phase("ssh_config", () => Promise.resolve("cfg"));
				return "done";
			});

			expect(result).toBe("done");
			const [phase1, phase2, parent] = h.sink.events;
			expect(phase1.eventName).toBe("remote.setup.phase");
			expect(phase2.eventName).toBe("remote.setup.phase");
			expect(parent).toMatchObject({
				eventName: "remote.setup",
				properties: { result: "success" },
			});
			expect(parent.traceId).toBeDefined();
			expect(phase1.traceId).toBe(parent.traceId);
			expect(phase2.traceId).toBe(parent.traceId);
		});

		it("on phase failure: completed phases emit success, parent emits error summary, error rethrown", async () => {
			const boom = new Error("phase-2-broke");
			const neverRuns = vi.fn(() => Promise.resolve("x"));

			await expect(
				h.service.trace("remote.setup", async (trace) => {
					await trace.phase("ok_phase", () => Promise.resolve("ok"));
					await trace.phase("bad_phase", () => Promise.reject(boom));
					await trace.phase("never_runs", neverRuns);
				}),
			).rejects.toBe(boom);

			expect(neverRuns).not.toHaveBeenCalled();
			const [okPhase, badPhase, parent] = h.sink.events;
			expect(okPhase.properties).toMatchObject({ result: "success" });
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
			await h.service.trace("op", async (trace) => {
				await trace.phase("first", () => Promise.resolve(""));
				h.service.setDeploymentUrl("https://coder.example.com");
				await trace.phase("second", () => Promise.resolve(""));
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

		it("suppresses log and logError emissions", () => {
			h.service.log("a");
			h.service.logError("b", new Error("ignored"));
			expect(h.sink.events).toHaveLength(0);
		});

		it("still runs the wrapped functions of time and trace but emits nothing", async () => {
			const timeFn = vi.fn(() => Promise.resolve(99));
			const phaseFn = vi.fn(() => Promise.resolve("x"));

			expect(await h.service.time("a", timeFn)).toBe(99);
			expect(
				await h.service.trace("b", async (t) => {
					await t.phase("p", phaseFn);
					return "done";
				}),
			).toBe("done");

			expect(timeFn).toHaveBeenCalled();
			expect(phaseFn).toHaveBeenCalled();
			expect(h.sink.events).toHaveLength(0);
		});
	});

	describe("reactive level", () => {
		it("flushes sinks on local → off, suppresses while off, and resumes on off → local", () => {
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
			h.config.set("coder.telemetry.level", "deployment");
			h.service.log("evt");
			expect(h.sink.events).toHaveLength(1);
		});
	});

	describe("multiple sinks", () => {
		it("a throwing sink does not block other sinks from receiving events", () => {
			const bad: TelemetrySink = {
				name: "bad",
				write: () => {
					throw new Error("boom");
				},
				flush: vi.fn(() => Promise.resolve()),
				dispose: vi.fn(() => Promise.resolve()),
			};
			const good = new TestSink("good");
			const service = makeService([bad, good]);

			service.log("activation");
			expect(good.events).toHaveLength(1);
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
