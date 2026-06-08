import { describe, expect, it } from "vitest";

import { WebSocketTelemetry } from "@/instrumentation/websocket";
import { ConnectionState } from "@/websocket/reconnectingWebSocket";

import { createTelemetryHarness } from "../../mocks/telemetry";

function setup() {
	const { sink, service } = createTelemetryHarness();
	return { ws: new WebSocketTelemetry(service), sink };
}

describe("WebSocketTelemetry", () => {
	describe("stateTransition", () => {
		it("emits a connection.state_transitioned event with from/to/reason", () => {
			const { ws, sink } = setup();

			ws.stateTransition(
				ConnectionState.IDLE,
				ConnectionState.CONNECTING,
				"initial_connect",
			);

			const [event] = sink.eventsNamed("connection.state_transitioned");
			expect(event.properties).toEqual({
				from: "IDLE",
				to: "CONNECTING",
				reason: "initial_connect",
			});
		});
	});

	describe("opened", () => {
		it("emits connection.opened with route and connect duration", () => {
			const { ws, sink } = setup();

			ws.connectStarted();
			ws.opened("/api/test");

			const [event] = sink.eventsNamed("connection.opened");
			expect(event).toMatchObject({
				properties: { route: "/api/test" },
				measurements: { connectDurationMs: expect.any(Number) },
			});
		});

		it("normalizes websocket URLs before emitting the route", () => {
			const { ws, sink } = setup();

			ws.opened(
				"wss://coder.example.com/api/v2/workspaces/123e4567-e89b-12d3-a456-426614174000/watch-ws?token=secret#fragment",
			);

			const [event] = sink.eventsNamed("connection.opened");
			expect(event.properties.route).toBe("/api/v2/workspaces/{id}/watch-ws");
		});

		it("uses 0 duration when connectStarted was not called", () => {
			const { ws, sink } = setup();

			ws.opened("/api/test");

			const [event] = sink.eventsNamed("connection.opened");
			expect(event.measurements.connectDurationMs).toBe(0);
		});
	});

	describe("dropped", () => {
		it("is silent when no connection has been opened", () => {
			const { ws, sink } = setup();

			ws.dropped("error");

			expect(sink.events).toHaveLength(0);
		});

		it("emits connection.dropped with cause and close code", () => {
			const { ws, sink } = setup();

			ws.opened("/api/test");
			ws.dropped("unexpected_close", 1006);

			const [event] = sink.eventsNamed("connection.dropped");
			expect(event.properties).toMatchObject({
				cause: "unexpected_close",
				closeCode: "1006",
			});
			expect(event.measurements.connectionDurationMs).toEqual(
				expect.any(Number),
			);
		});

		it("emits via logError when an error is provided", () => {
			const { ws, sink } = setup();

			ws.opened("/api/test");
			ws.dropped("error", 1006, new Error("boom"));

			const [event] = sink.eventsNamed("connection.dropped");
			expect(event.error).toMatchObject({ message: "boom" });
		});

		it("does not double-emit when called twice", () => {
			const { ws, sink } = setup();

			ws.opened("/api/test");
			ws.dropped("normal_close");
			ws.dropped("error");

			expect(sink.eventsNamed("connection.dropped")).toHaveLength(1);
		});
	});

	describe("reset", () => {
		it("clears state so a subsequent dropped is silent", () => {
			const { ws, sink } = setup();

			ws.opened("/api/test");
			ws.reset();
			ws.dropped("error");

			expect(sink.eventsNamed("connection.dropped")).toHaveLength(0);
		});

		it("clears any open reconnect cycle", () => {
			const { ws, sink } = setup();

			ws.reconnectStarted("manual_reconnect");
			ws.connectStarted();
			ws.reset();
			ws.opened("/api/test");

			expect(sink.eventsNamed("connection.reconnect_resolved")).toHaveLength(0);
		});
	});

	describe("reconnect cycle", () => {
		it("emits connection.reconnect_resolved with success when opened closes the cycle", () => {
			const { ws, sink } = setup();

			ws.reconnectStarted("manual_reconnect");
			ws.connectStarted();
			ws.opened("/api/test");

			const [event] = sink.eventsNamed("connection.reconnect_resolved");
			expect(event).toMatchObject({
				properties: {
					result: "success",
					reason: "manual_reconnect",
					attemptBucket: "1",
					maxBackoffBucket: "none",
				},
				measurements: { attempts: 1, totalDurationMs: expect.any(Number) },
			});
		});

		it("emits connection.reconnect_resolved with error when terminated closes the cycle", () => {
			const { ws, sink } = setup();

			ws.reconnectStarted("manual_reconnect");
			ws.terminated("unrecoverable_http", { cause: "error" });

			const [event] = sink.eventsNamed("connection.reconnect_resolved");
			expect(event.properties).toEqual({
				result: "error",
				reason: "manual_reconnect",
				attemptBucket: "0",
				maxBackoffBucket: "none",
				terminationReason: "unrecoverable_http",
			});
		});

		it("does not emit when terminated is called outside a cycle", () => {
			const { ws, sink } = setup();

			ws.terminated("dispose", { cause: "disposed" });

			expect(sink.eventsNamed("connection.reconnect_resolved")).toHaveLength(0);
		});

		it("counts each connectStarted as an attempt within the cycle", () => {
			const { ws, sink } = setup();

			ws.reconnectStarted("scheduled_reconnect");
			ws.connectStarted();
			ws.connectStarted();
			ws.connectStarted();
			ws.opened("/api/test");

			expect(
				sink.eventsNamed("connection.reconnect_resolved")[0].measurements
					.attempts,
			).toBe(3);
		});

		it("ignores reconnectStarted while a cycle is already open", () => {
			const { ws, sink } = setup();

			ws.reconnectStarted("manual_reconnect");
			ws.reconnectStarted("scheduled_reconnect");
			ws.opened("/api/test");

			expect(
				sink.eventsNamed("connection.reconnect_resolved")[0].properties.reason,
			).toBe("manual_reconnect");
		});

		it("retrying drops the connection and opens a cycle", () => {
			const { ws, sink } = setup();

			ws.opened("/api/test");
			ws.retrying(
				"unexpected_close",
				{
					cause: "unexpected_close",
					code: 1006,
				},
				250,
			);

			expect(sink.eventsNamed("connection.dropped")).toHaveLength(1);

			ws.opened("/api/test");
			expect(sink.eventsNamed("connection.reconnect_resolved")).toMatchObject([
				{
					properties: {
						attemptBucket: "0",
						maxBackoffBucket: "<1s",
					},
				},
			]);
		});
	});
});
