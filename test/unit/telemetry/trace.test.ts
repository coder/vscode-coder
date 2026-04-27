import { describe, expect, it, vi } from "vitest";

import { type EmitFn, Trace } from "@/telemetry/trace";

interface RecordedCall {
	eventName: string;
	properties: Record<string, string>;
	measurements: Record<string, number>;
	traceId?: string;
	error?: unknown;
}

function makeRecorder(): { emit: EmitFn; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	const emit: EmitFn = (
		eventName,
		properties,
		measurements,
		traceId,
		error,
	) => {
		calls.push({ eventName, properties, measurements, traceId, error });
	};
	return { emit, calls };
}

describe("Trace.phase", () => {
	it("emits a child '<parent>.phase' event with the parent's traceId on success", async () => {
		const { emit, calls } = makeRecorder();
		const trace = new Trace("remote.setup", "trace-1", emit);

		const result = await trace.phase("workspace_lookup", () =>
			Promise.resolve("ws"),
		);

		expect(result).toBe("ws");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			eventName: "remote.setup.phase",
			properties: { phase: "workspace_lookup", result: "success" },
			traceId: "trace-1",
			error: undefined,
		});
		expect(calls[0].measurements.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("merges caller properties without overwriting phase or result", async () => {
		const { emit, calls } = makeRecorder();
		const trace = new Trace("op", "tid", emit);

		await trace.phase("p", () => Promise.resolve(0), { extra: "yes" });

		expect(calls[0].properties).toEqual({
			extra: "yes",
			phase: "p",
			result: "success",
		});
	});

	it("emits an error event and rethrows when the wrapped fn rejects", async () => {
		const { emit, calls } = makeRecorder();
		const trace = new Trace("op", "tid", emit);
		const boom = new Error("nope");

		await expect(trace.phase("p", () => Promise.reject(boom))).rejects.toBe(
			boom,
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			eventName: "op.phase",
			properties: { phase: "p", result: "error" },
			traceId: "tid",
			error: boom,
		});
	});

	it("does not run subsequent code after a phase rejection inside the caller", async () => {
		const { emit } = makeRecorder();
		const trace = new Trace("op", "tid", emit);
		const after = vi.fn();

		await expect(
			(async () => {
				await trace.phase("bad", () => Promise.reject(new Error("x")));
				after();
			})(),
		).rejects.toThrow("x");

		expect(after).not.toHaveBeenCalled();
	});
});
