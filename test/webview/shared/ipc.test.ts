import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineCommand, defineNotification } from "@repo/shared";
import { onNotification, sendCommand } from "@repo/webview-shared/ipc";

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

	it("posts without params for void-payload commands", () => {
		const cmd = defineCommand<void>("ns/noop");
		sendCommand(cmd);

		expect(sent).toEqual([{ method: "ns/noop", params: undefined }]);
	});
});

describe("onNotification", () => {
	it("invokes callback only for matching method", () => {
		const def = defineNotification<{ count: number }>("ns/updated");
		const cb = vi.fn();

		const unsubscribe = onNotification(def, cb);

		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "ns/other", data: { count: 1 } },
			}),
		);
		expect(cb).not.toHaveBeenCalled();

		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "ns/updated", data: { count: 7 } },
			}),
		);
		expect(cb).toHaveBeenCalledWith({ count: 7 });

		unsubscribe();
	});

	it("stops receiving events after unsubscribe", () => {
		const def = defineNotification<string>("ns/ping");
		const cb = vi.fn();

		const unsubscribe = onNotification(def, cb);
		unsubscribe();

		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "ns/ping", data: "hello" },
			}),
		);

		expect(cb).not.toHaveBeenCalled();
	});

	it("ignores non-object messages", () => {
		const def = defineNotification<string>("ns/evt");
		const cb = vi.fn();
		const unsubscribe = onNotification(def, cb);

		window.dispatchEvent(new MessageEvent("message", { data: null }));
		window.dispatchEvent(new MessageEvent("message", { data: "string" }));
		window.dispatchEvent(new MessageEvent("message", { data: 42 }));

		expect(cb).not.toHaveBeenCalled();
		unsubscribe();
	});

	it("supports multiple independent subscribers", () => {
		const def = defineNotification<number>("ns/count");
		const a = vi.fn();
		const b = vi.fn();

		const unsubA = onNotification(def, a);
		const unsubB = onNotification(def, b);

		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "ns/count", data: 1 } }),
		);

		expect(a).toHaveBeenCalledWith(1);
		expect(b).toHaveBeenCalledWith(1);

		unsubA();
		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "ns/count", data: 2 } }),
		);

		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(2);

		unsubB();
	});
});
