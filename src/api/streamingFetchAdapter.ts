import { type AxiosInstance } from "axios";
import { type FetchLikeInit, type FetchLikeResponse } from "eventsource";
import { type IncomingMessage } from "node:http";

/**
 * Creates a fetch adapter using an Axios instance that returns streaming responses.
 * This is used by EventSource to make authenticated SSE connections.
 */
export function createStreamingFetchAdapter(
	axiosInstance: AxiosInstance,
	configHeaders?: Record<string, string>,
): (url: string | URL, init?: FetchLikeInit) => Promise<FetchLikeResponse> {
	return async (
		url: string | URL,
		init?: FetchLikeInit,
	): Promise<FetchLikeResponse> => {
		const urlStr = url.toString();

		const response = await axiosInstance.request<IncomingMessage>({
			url: urlStr,
			signal: init?.signal,
			headers: { ...init?.headers, ...configHeaders },
			responseType: "stream",
			validateStatus: () => true, // Don't throw on any status code
		});

		const stream = new ReadableStream({
			start(controller) {
				response.data.on("data", (chunk: Buffer) => {
					try {
						controller.enqueue(chunk);
					} catch {
						// Stream already closed or errored, ignore
					}
				});

				response.data.on("end", () => {
					try {
						controller.close();
					} catch {
						// Stream already closed, ignore
					}
				});

				response.data.on("error", (err: Error) => {
					controller.error(err);
				});
			},

			cancel() {
				response.data.destroy();
				return Promise.resolve();
			},
		});

		return {
			body: {
				getReader: () => stream.getReader(),
			},
			url: urlStr,
			status: response.status,
			redirected: response.request?.res?.responseUrl !== urlStr,
			headers: {
				get: (name: string) => {
					const value = response.headers[name.toLowerCase()];
					return value === undefined ? null : String(value);
				},
			},
		};
	};
}
