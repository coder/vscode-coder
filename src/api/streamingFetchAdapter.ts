import { type AxiosInstance } from "axios";
import { type EventSourceFetchInit, type FetchLikeResponse } from "eventsource";
import { type IncomingMessage } from "node:http";

/**
 * Creates a fetch adapter using an Axios instance that returns streaming responses.
 * This is used by EventSource to make authenticated SSE connections.
 */
export function createStreamingFetchAdapter(
	axiosInstance: AxiosInstance,
	configHeaders?: Record<string, string>,
): (
	url: string | URL,
	init?: EventSourceFetchInit,
) => Promise<FetchLikeResponse> {
	return async (
		url: string | URL,
		init?: EventSourceFetchInit,
	): Promise<FetchLikeResponse> => {
		const urlStr = url.toString();

		const response = await axiosInstance.request<IncomingMessage>({
			url: urlStr,
			signal: init?.signal as AbortSignal | undefined,
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

		const castRequest = response.request as
			| { res?: { responseUrl?: string } }
			| undefined;

		return {
			body: {
				getReader: () => stream.getReader(),
			},
			url: urlStr,
			status: response.status,
			redirected: castRequest?.res?.responseUrl !== urlStr,
			headers: {
				get: (name: string) => {
					const value = response.headers[name.toLowerCase()] as unknown;
					return typeof value === "string" ? value : null;
				},
			},
		};
	};
}
