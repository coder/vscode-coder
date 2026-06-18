import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { DismissibleNotifier } from "@/core/dismissibleNotifier";

import { InMemoryMemento } from "../../mocks/testHelpers";

const KEY = "coder.proxyUseLocalServerWarningDismissed";

function setup(dismissed = false) {
	vi.clearAllMocks();
	const memento = new InMemoryMemento();
	if (dismissed) {
		void memento.update(KEY, true);
	}
	return {
		memento,
		notifier: new DismissibleNotifier(memento),
		showMessage: vi.mocked(vscode.window.showWarningMessage),
	};
}

describe("DismissibleNotifier.showDismissible", () => {
	it("returns the chosen action without persisting", async () => {
		const { notifier, memento, showMessage } = setup();
		showMessage.mockResolvedValue("Enable" as never);

		const choice = await notifier.showDismissible(KEY, "m", {
			actions: ["Enable"],
			modal: true,
		});

		expect(choice).toBe("Enable");
		expect(memento.get(KEY)).toBeUndefined();
		expect(showMessage).toHaveBeenCalledWith(
			"m",
			{ modal: true },
			"Enable",
			"Don't Show Again",
		);
	});

	it("persists dismissal and returns undefined when dismissed", async () => {
		const { notifier, memento, showMessage } = setup();
		showMessage.mockResolvedValue("Don't Show Again" as never);

		expect(await notifier.showDismissible(KEY, "m")).toBeUndefined();
		expect(memento.get(KEY)).toBe(true);
	});

	it("stays silent once dismissed", async () => {
		const { notifier, showMessage } = setup(true);

		expect(await notifier.showDismissible(KEY, "m")).toBeUndefined();
		expect(showMessage).not.toHaveBeenCalled();
	});
});
