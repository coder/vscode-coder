import { type AxiosInstance, type AxiosResponse } from "axios";
import { type ReaderLike } from "eventsource";
import { EventEmitter } from "node:events";
import { type IncomingMessage } from "node:http";
import { describe, it, expect, vi } from "vitest";

import { createStreamingFetchAdapter } from "@/api/streamingFetchAdapter";

const TEST_URL = "https://example.com/api";

describe("createStreamingFetchAdapter", () => {
	describe("Request Handling", () => {
		it("passes URL, signal, and responseType to axios", async () => {
			const mockAxios = createAxiosMock();
			const mockStream = createMockStream();
			setupAxiosResponse(mockAxios, 200, {}, mockStream);

			const adapter = createStreamingFetchAdapter(mockAxios);
			const signal = new AbortController().signal;

			await adapter(TEST_URL, { signal });

			expect(mockAxios.request).toHaveBeenCalledWith({
				url: TEST_URL,
				signal, // correctly passes signal
				headers: {},
				responseType: "stream",
				validateStatus: expect.any(Function),
			});
		});

		it("applies headers in correct precedence order (config overrides init)", async () => {
			const mockAxios = createAxiosMock();
			const mockStream = createMockStream();
			setupAxiosResponse(mockAxios, 200, {}, mockStream);

			// Test 1: No config headers, only init headers
			const adapter1 = createStreamingFetchAdapter(mockAxios);
			await adapter1(TEST_URL, {
				headers: { "X-Init": "init-value" },
			});

			expect(mockAxios.request).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: { "X-Init": "init-value" },
				}),
			);

			// Test 2: Config headers merge with init headers
			const adapter2 = createStreamingFetchAdapter(mockAxios, {
				"X-Config": "config-value",
			});
			await adapter2(TEST_URL, {
				headers: { "X-Init": "init-value" },
			});

			expect(mockAxios.request).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: {
						"X-Init": "init-value",
						"X-Config": "config-value",
					},
				}),
			);

			// Test 3: Config headers override init headers
			const adapter3 = createStreamingFetchAdapter(mockAxios, {
				"X-Header": "config-value",
			});
			await adapter3(TEST_URL, {
				headers: { "X-Header": "init-value" },
			});

			expect(mockAxios.request).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: { "X-Header": "config-value" },
				}),
			);
		});
	});

	describe("Response Properties", () => {
		it("returns response with correct properties", async () => {
			const mockAxios = createAxiosMock();
			const mockStream = createMockStream();
			setupAxiosResponse(
				mockAxios,
				200,
				{ "content-type": "text/event-stream" },
				mockStream,
			);

			const adapter = createStreamingFetchAdapter(mockAxios);
			const response = await adapter(TEST_URL);

			expect(response.url).toBe(TEST_URL);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("text/event-stream");
			// Headers are lowercased when we retrieve them
			expect(response.headers.get("CoNtEnT-TyPe")).toBe("text/event-stream");
			expect(response.body?.getReader).toBeDefined();
		});

		it("detects redirected requests", async () => {
			const mockAxios = createAxiosMock();
			const mockStream = createMockStream();
			const mockResponse = {
				status: 200,
				headers: {},
				data: mockStream,
				request: {
					res: {
						responseUrl: "https://redirect.com/api",
					},
				},
			} as AxiosResponse<IncomingMessage>;
			vi.mocked(mockAxios.request).mockResolvedValue(mockResponse);

			const adapter = createStreamingFetchAdapter(mockAxios);
			const response = await adapter(TEST_URL);

			expect(response.redirected).toBe(true);
		});
	});

	describe("Stream Handling", () => {
		it("enqueues data chunks from stream", async () => {
			const { mockStream, reader } = await setupReaderTest();

			const chunk1 = Buffer.from("data1");
			const chunk2 = Buffer.from("data2");
			mockStream.emit("data", chunk1);
			mockStream.emit("data", chunk2);
			mockStream.emit("end");

			const result1 = await reader.read();
			expect(result1.value).toEqual(chunk1);
			expect(result1.done).toBe(false);

			const result2 = await reader.read();
			expect(result2.value).toEqual(chunk2);
			expect(result2.done).toBe(false);

			const result3 = await reader.read();
			// Closed after end
			expect(result3.done).toBe(true);
		});

		it("propagates stream errors", async () => {
			const { mockStream, reader } = await setupReaderTest();

			const error = new Error("Stream error");
			mockStream.emit("error", error);

			await expect(reader.read()).rejects.toThrow("Stream error");
		});

		it("handles errors after stream is closed", async () => {
			const { mockStream, reader } = await setupReaderTest();

			mockStream.emit("end");
			await reader.read();

			// Emit events after stream is closed - should not throw
			expect(() => mockStream.emit("data", Buffer.from("late"))).not.toThrow();
			expect(() => mockStream.emit("end")).not.toThrow();
		});

		it("destroys stream on cancel", async () => {
			const { mockStream, reader } = await setupReaderTest();

			await reader.cancel();

			expect(mockStream.destroy).toHaveBeenCalled();
		});
	});
});

function createAxiosMock(): AxiosInstance {
	return {
		request: vi.fn(),
	} as unknown as AxiosInstance;
}

function createMockStream(): IncomingMessage {
	const stream = new EventEmitter() as IncomingMessage;
	stream.destroy = vi.fn();
	return stream;
}

function setupAxiosResponse(
	axios: AxiosInstance,
	status: number,
	headers: Record<string, string>,
	stream: IncomingMessage,
): void {
	vi.mocked(axios.request).mockResolvedValue({
		status,
		headers,
		data: stream,
	});
}

async function setupReaderTest(): Promise<{
	mockStream: IncomingMessage;
	reader: ReaderLike | ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
}> {
	const mockAxios = createAxiosMock();
	const mockStream = createMockStream();
	setupAxiosResponse(mockAxios, 200, {}, mockStream);

	const adapter = createStreamingFetchAdapter(mockAxios);
	const response = await adapter(TEST_URL);
	const reader = response.body?.getReader();
	if (reader === undefined) {
		throw new Error("Reader is undefined");
	}

	return { mockStream, reader };
}
