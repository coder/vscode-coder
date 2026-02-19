import { describe, expect, it, vi } from "vitest";

import { LazyStream } from "@/api/workspace";
import { type UnidirectionalStream } from "@/websocket/eventStreamConnection";

function mockStream(): UnidirectionalStream<unknown> {
	return {
		url: "ws://test",
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		close: vi.fn(),
	};
}

type StreamFactory = () => Promise<UnidirectionalStream<unknown>>;

/** Creates a factory whose promise can be resolved manually. */
function deferredFactory() {
	let resolve!: (s: UnidirectionalStream<unknown>) => void;
	const factory: StreamFactory = vi.fn().mockReturnValue(
		new Promise<UnidirectionalStream<unknown>>((r) => {
			resolve = r;
		}),
	);
	return {
		factory,
		resolve: (s?: UnidirectionalStream<unknown>) => resolve(s ?? mockStream()),
	};
}

describe("LazyStream", () => {
	it("opens once and ignores subsequent calls", async () => {
		const factory: StreamFactory = vi.fn().mockResolvedValue(mockStream());
		const lazy = new LazyStream();

		await lazy.open(factory);
		await lazy.open(factory);

		expect(factory).toHaveBeenCalledOnce();
	});

	it("can reopen after close", async () => {
		const factory: StreamFactory = vi.fn().mockResolvedValue(mockStream());
		const lazy = new LazyStream();

		await lazy.open(factory);
		lazy.close();
		await lazy.open(factory);

		expect(factory).toHaveBeenCalledTimes(2);
	});

	it("closes the underlying stream", async () => {
		const stream = mockStream();
		const lazy = new LazyStream();

		await lazy.open(() => Promise.resolve(stream));
		lazy.close();

		expect(stream.close).toHaveBeenCalledOnce();
	});

	it("deduplicates concurrent opens", async () => {
		const { factory, resolve } = deferredFactory();
		const lazy = new LazyStream();

		const p1 = lazy.open(factory);
		const p2 = lazy.open(factory);
		resolve();
		await Promise.all([p1, p2]);

		expect(factory).toHaveBeenCalledOnce();
	});

	it("allows reopening after close during pending open", async () => {
		const { factory, resolve } = deferredFactory();
		const lazy = new LazyStream();

		const p = lazy.open(factory);
		lazy.close();
		resolve();
		await p.catch(() => {});

		const factory2: StreamFactory = vi.fn().mockResolvedValue(mockStream());
		await lazy.open(factory2);
		expect(factory2).toHaveBeenCalledOnce();
	});
});
