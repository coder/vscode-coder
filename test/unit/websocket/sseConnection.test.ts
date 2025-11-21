import axios, { type AxiosInstance } from "axios";
import { type ServerSentEvent } from "coder/site/src/api/typesGenerated";
import { type WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";
import { EventSource } from "eventsource";
import { describe, it, expect, vi } from "vitest";

import { type Logger } from "@/logging/logger";
import { WebSocketCloseCode } from "@/websocket/codes";
import {
	type ParsedMessageEvent,
	type CloseEvent,
	type ErrorEvent,
} from "@/websocket/eventStreamConnection";
import { SseConnection } from "@/websocket/sseConnection";

import { createMockLogger } from "../../mocks/testHelpers";

const TEST_URL = "https://coder.example.com";
const API_ROUTE = "/api/v2/workspaces/123/watch";

vi.mock("eventsource");
vi.mock("axios");

vi.mock("@/api/streamingFetchAdapter", () => ({
	createStreamingFetchAdapter: vi.fn(() => fetch),
}));

describe("SseConnection", () => {
	describe("URL Building", () => {
		type UrlBuildingTestCase = [
			searchParams: Record<string, string> | URLSearchParams | undefined,
			expectedUrl: string,
		];
		it.each<UrlBuildingTestCase>([
			[undefined, `${TEST_URL}${API_ROUTE}`],
			[
				{ follow: "true", after: "123" },
				`${TEST_URL}${API_ROUTE}?follow=true&after=123`,
			],
			[new URLSearchParams({ foo: "bar" }), `${TEST_URL}${API_ROUTE}?foo=bar`],
		])("constructs URL with %s search params", (searchParams, expectedUrl) => {
			const mockAxios = axios.create();
			const mockLogger = createMockLogger();
			const mockES = createMockEventSource();
			setupEventSourceMock(mockES);

			const connection = new SseConnection({
				location: { protocol: "https:", host: "coder.example.com" },
				apiRoute: API_ROUTE,
				searchParams,
				axiosInstance: mockAxios,
				logger: mockLogger,
			});
			expect(connection.url).toBe(expectedUrl);
		});
	});

	describe("Event Handling", () => {
		it("fires open event and supports multiple listeners", async () => {
			const mockES = createMockEventSource({
				addEventListener: vi.fn((event, handler) => {
					if (event === "open") {
						setImmediate(() => handler(new Event("open")));
					}
				}),
			});
			setupEventSourceMock(mockES);

			const mockAxios = axios.create();
			const mockLogger = createMockLogger();
			const connection = createConnection(mockAxios, mockLogger);
			const events1: object[] = [];
			const events2: object[] = [];
			connection.addEventListener("open", (event) => events1.push(event));
			connection.addEventListener("open", (event) => events2.push(event));

			await waitForNextTick();
			expect(events1).toEqual([{}]);
			expect(events2).toEqual([{}]);
		});

		it("fires message event with parsed JSON and handles parse errors", async () => {
			const testData = { type: "data", workspace: { status: "running" } };
			const mockES = createMockEventSource({
				addEventListener: vi.fn((event, handler) => {
					if (event === "data") {
						setImmediate(() => {
							// Send valid JSON
							handler(
								new MessageEvent("data", { data: JSON.stringify(testData) }),
							);
							// Send invalid JSON
							handler(new MessageEvent("data", { data: "not-valid-json" }));
						});
					}
				}),
			});
			setupEventSourceMock(mockES);

			const mockAxios = axios.create();
			const mockLogger = createMockLogger();
			const connection = createConnection(mockAxios, mockLogger);
			const events: ParsedMessageEvent<ServerSentEvent>[] = [];
			connection.addEventListener("message", (event) => events.push(event));

			await waitForNextTick();
			expect(events).toEqual([
				{
					sourceEvent: { data: JSON.stringify(testData) },
					parsedMessage: { type: "data", data: testData },
					parseError: undefined,
				},
				{
					sourceEvent: { data: "not-valid-json" },
					parsedMessage: undefined,
					parseError: expect.any(Error),
				},
			]);
		});

		it("fires error event when connection fails", async () => {
			const mockES = createMockEventSource({
				addEventListener: vi.fn((event, handler) => {
					if (event === "error") {
						const error = {
							message: "Connection failed",
							error: new Error("Network error"),
						};
						setImmediate(() => handler(error));
					}
				}),
			});
			setupEventSourceMock(mockES);

			const mockAxios = axios.create();
			const mockLogger = createMockLogger();
			const connection = createConnection(mockAxios, mockLogger);
			const events: ErrorEvent[] = [];
			connection.addEventListener("error", (event) => events.push(event));

			await waitForNextTick();
			expect(events).toEqual([
				{
					error: expect.any(Error),
					message: "Connection failed",
				},
			]);
		});

		it("fires close event when connection closes on error", async () => {
			const mockES = createMockEventSource({
				addEventListener: vi.fn((event, handler) => {
					if (event === "error") {
						setImmediate(() => {
							// A bit hacky but readyState is a readonly property so we have to override that here
							const esWithReadyState = mockES as { readyState: number };
							// Simulate EventSource behavior: state transitions to CLOSED when error occurs
							esWithReadyState.readyState = EventSource.CLOSED;
							handler(new Event("error"));
						});
					}
				}),
			});
			setupEventSourceMock(mockES);

			const mockAxios = axios.create();
			const mockLogger = createMockLogger();
			const connection = createConnection(mockAxios, mockLogger);
			const events: CloseEvent[] = [];
			connection.addEventListener("close", (event) => events.push(event));

			await waitForNextTick();
			expect(events).toEqual([
				{
					code: WebSocketCloseCode.ABNORMAL,
					reason: "Connection lost",
					wasClean: false,
				},
			]);
		});
	});

	describe("Event Listener Management", () => {
		it("removes event listener without affecting others", async () => {
			const data = '{"test": true}';
			const mockES = createMockEventSource({
				addEventListener: vi.fn((event, handler) => {
					if (event === "data") {
						setImmediate(() => handler(new MessageEvent("data", { data })));
					}
				}),
			});
			setupEventSourceMock(mockES);

			const mockAxios = axios.create();
			const mockLogger = createMockLogger();
			const connection = createConnection(mockAxios, mockLogger);
			const events: ParsedMessageEvent<ServerSentEvent>[] = [];

			const removedHandler = () => {
				throw new Error("Removed handler should not have been called!");
			};
			const keptHandler = (event: ParsedMessageEvent<ServerSentEvent>) =>
				events.push(event);

			connection.addEventListener("message", removedHandler);
			connection.addEventListener("message", keptHandler);
			connection.removeEventListener("message", removedHandler);

			await waitForNextTick();
			// One message event
			expect(events).toEqual([
				{
					parseError: undefined,
					parsedMessage: {
						data: JSON.parse(data),
						type: "data",
					},
					sourceEvent: { data },
				},
			]);
			expect(mockLogger.error).not.toHaveBeenCalled();
		});
	});

	describe("Close Handling", () => {
		type CloseHandlingTestCase = [
			code: number | undefined,
			reason: string | undefined,
			closeEvent: CloseEvent,
		];
		it.each<CloseHandlingTestCase>([
			[
				undefined,
				undefined,
				{
					code: WebSocketCloseCode.NORMAL,
					reason: "Normal closure",
					wasClean: true,
				},
			],
			[
				4000,
				"Custom close",
				{ code: 4000, reason: "Custom close", wasClean: true },
			],
		])(
			"closes EventSource with code '%s' and reason '%s'",
			(code, reason, closeEvent) => {
				const mockES = createMockEventSource();
				setupEventSourceMock(mockES);

				const mockAxios = axios.create();
				const mockLogger = createMockLogger();
				const connection = createConnection(mockAxios, mockLogger);
				const events: CloseEvent[] = [];
				connection.addEventListener("close", (event) => events.push(event));
				connection.addEventListener("open", () => {});

				connection.close(code, reason);
				expect(mockES.close).toHaveBeenCalled();
				expect(events).toEqual([closeEvent]);
			},
		);
	});

	describe("Callback Error Handling", () => {
		type CallbackErrorTestCase = [
			sseEvent: WebSocketEventType,
			eventData: Event | MessageEvent,
		];
		it.each<CallbackErrorTestCase>([
			["open", new Event("open")],
			["message", new MessageEvent("data", { data: '{"test": true}' })],
			["error", new Event("error")],
		])(
			"logs error and continues when %s callback throws",
			async (sseEvent, eventData) => {
				const mockES = createMockEventSource({
					addEventListener: vi.fn((event, handler) => {
						// All SSE events are streaming data and attach a listener on the "data" type in the EventSource
						const esEvent = sseEvent === "message" ? "data" : sseEvent;
						if (event === esEvent) {
							setImmediate(() => handler(eventData));
						}
					}),
				});
				setupEventSourceMock(mockES);

				const mockAxios = axios.create();
				const mockLogger = createMockLogger();
				const connection = createConnection(mockAxios, mockLogger);
				const events: unknown[] = [];

				connection.addEventListener(sseEvent, () => {
					throw new Error("Handler error");
				});
				connection.addEventListener(sseEvent, (event: unknown) =>
					events.push(event),
				);

				await waitForNextTick();
				expect(events).toHaveLength(1);
				expect(mockLogger.error).toHaveBeenCalledWith(
					`Error in SSE ${sseEvent} callback:`,
					expect.any(Error),
				);
			},
		);

		it("completes cleanup when close callback throws", () => {
			const mockES = createMockEventSource();
			setupEventSourceMock(mockES);

			const mockAxios = axios.create();
			const mockLogger = createMockLogger();
			const connection = createConnection(mockAxios, mockLogger);
			connection.addEventListener("close", () => {
				throw new Error("Handler error");
			});

			connection.close();

			expect(mockES.close).toHaveBeenCalled();
			expect(mockLogger.error).toHaveBeenCalledWith(
				"Error in SSE close callback:",
				expect.any(Error),
			);
		});
	});
});

function createConnection(
	mockAxios: AxiosInstance,
	mockLogger: Logger,
): SseConnection {
	return new SseConnection({
		location: { protocol: "https:", host: "coder.example.com" },
		apiRoute: API_ROUTE,
		axiosInstance: mockAxios,
		logger: mockLogger,
	});
}

function createMockEventSource(
	overrides?: Partial<EventSource>,
): Partial<EventSource> {
	return {
		url: `${TEST_URL}${API_ROUTE}`,
		readyState: EventSource.CONNECTING,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		close: vi.fn(),
		...overrides,
	};
}

function setupEventSourceMock(es: Partial<EventSource>): void {
	vi.mocked(EventSource).mockImplementation(() => es as EventSource);
}

function waitForNextTick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
