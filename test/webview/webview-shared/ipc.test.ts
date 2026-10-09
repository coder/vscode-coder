import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineCommand, defineNotification } from "@repo/shared";
import { sendCommand, subscribeNotifications } from "@repo/webview-shared/ipc";

interface Sent {
	method: string;
	params?: unknown;
}

const sent: Sent[] = [];

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: (msg: Sent) => sent.push(msg),
		getState: () => undefined,
		setState: () => undefined,
	})),
);

beforeEach(() => {
	sent.length = 0;
});

describe("sendCommand", () => {
	it("posts {method, params}", () => {
		const cmd = defineCommand<{ id: string }>("ns/doThing");
		sendCommand(cmd, { id: "42" });
		expect(sent).toEqual([{ method: "ns/doThing", params: { id: "42" } }]);
	});

	it("omits params for void-payload commands", () => {
		const cmd = defineCommand<void>("ns/noop");
		sendCommand(cmd);
		expect(sent).toEqual([{ method: "ns/noop" }]);
	});
});

describe("subscribeNotifications", () => {
	const Api = {
		updated: defineNotification<{ count: number }>("ns/updated"),
		ping: defineNotification<void>("ns/ping"),
		// non-notification entries are ignored.
		doThing: defineCommand<{ id: string }>("ns/doThing"),
	} as const;

	it("invokes the matching handler with typed data", () => {
		const updated = vi.fn();
		const ping = vi.fn();
		const unsub = subscribeNotifications(Api, { updated, ping });

		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "ns/updated", data: { count: 7 } },
			}),
		);
		expect(updated).toHaveBeenCalledWith({ count: 7 });
		expect(ping).not.toHaveBeenCalled();

		unsub();
	});

	it("ignores non-matching messages", () => {
		const updated = vi.fn();
		const ping = vi.fn();
		const unsub = subscribeNotifications(Api, { updated, ping });

		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "ns/other" } }),
		);
		window.dispatchEvent(new MessageEvent("message", { data: null }));
		window.dispatchEvent(new MessageEvent("message", { data: 42 }));

		expect(updated).not.toHaveBeenCalled();
		expect(ping).not.toHaveBeenCalled();

		unsub();
	});

	it("fires void notifications with undefined data", () => {
		const updated = vi.fn();
		const ping = vi.fn();
		const unsub = subscribeNotifications(Api, { updated, ping });

		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "ns/ping" } }),
		);
		expect(ping).toHaveBeenCalledWith(undefined);

		unsub();
	});

	it("unsubscribes every handler when the returned function is called", () => {
		const updated = vi.fn();
		const ping = vi.fn();
		const unsub = subscribeNotifications(Api, { updated, ping });

		unsub();

		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "ns/updated", data: { count: 1 } },
			}),
		);
		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "ns/ping" } }),
		);

		expect(updated).not.toHaveBeenCalled();
		expect(ping).not.toHaveBeenCalled();
	});
});
