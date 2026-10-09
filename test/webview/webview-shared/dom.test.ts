import { describe, expect, it, vi } from "vitest";

import {
	emptyMessage,
	errorMessage,
	viewJsonAction,
} from "@repo/webview-shared";

describe("viewJsonAction", () => {
	it("renders a View JSON button that fires onClick", () => {
		const onClick = vi.fn();
		const actions = viewJsonAction(onClick);
		const button = actions.querySelector("button");

		expect(actions.className).toBe("actions");
		expect(button?.textContent).toBe("View JSON");

		button?.click();
		expect(onClick).toHaveBeenCalledTimes(1);
	});
});

describe("emptyMessage / errorMessage", () => {
	it("render labeled paragraphs", () => {
		const empty = emptyMessage("nothing here");
		expect(empty.className).toBe("empty");
		expect(empty.textContent).toBe("nothing here");

		const error = errorMessage("it broke");
		expect(error.className).toBe("error");
		expect(error.textContent).toBe("it broke");
	});
});
