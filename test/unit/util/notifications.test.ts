import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { showDismissibleNotification } from "@/util/notifications";

function fakeMemento(initial: Record<string, unknown> = {}): vscode.Memento {
	const store = new Map(Object.entries(initial));
	return {
		get: (key: string) => store.get(key),
		update: (key: string, value: unknown) => {
			store.set(key, value);
			return Promise.resolve();
		},
		keys: () => [...store.keys()],
	};
}

describe("showDismissibleNotification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the chosen action without persisting", async () => {
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
			"Enable" as never,
		);
		const memento = fakeMemento();

		const choice = await showDismissibleNotification("m", memento, {
			key: "k",
			actions: ["Enable"],
		});

		expect(choice).toBe("Enable");
		expect(memento.get("k")).toBeUndefined();
	});

	it("persists dismissal and returns undefined when dismissed", async () => {
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
			"Don't Show Again" as never,
		);
		const memento = fakeMemento();

		const choice = await showDismissibleNotification("m", memento, {
			key: "k",
		});

		expect(choice).toBeUndefined();
		expect(memento.get("k")).toBe(true);
	});

	it("shows nothing once dismissed", async () => {
		const memento = fakeMemento({ k: true });

		const choice = await showDismissibleNotification("m", memento, {
			key: "k",
		});

		expect(choice).toBeUndefined();
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});
});
