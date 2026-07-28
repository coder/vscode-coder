import { describe, expect, it } from "vitest";

import { formatKeybinding } from "@repo/ui";

describe("formatKeybinding", () => {
	it("renders macOS glyphs in canonical order without separators", () => {
		expect(formatKeybinding("shift+cmd+r", "mac")).toBe("⇧⌘R");
		expect(formatKeybinding("ctrl+alt+up", "mac")).toBe("⌃⌥UpArrow");
	});

	it("joins full labels with + on Windows and Linux", () => {
		expect(formatKeybinding("ctrl+shift+r", "win")).toBe("Ctrl+Shift+R");
		expect(formatKeybinding("meta+e", "win")).toBe("Windows+E");
		expect(formatKeybinding("meta+e", "linux")).toBe("Super+E");
	});

	it("picks the platform's contribution field and falls back to key", () => {
		const keys = { key: "ctrl+shift+r", mac: "cmd+shift+r" };
		expect(formatKeybinding(keys, "mac")).toBe("⇧⌘R");
		expect(formatKeybinding(keys, "linux")).toBe("Ctrl+Shift+R");
	});

	it("formats each chord of a sequence", () => {
		expect(formatKeybinding("ctrl+k ctrl+s", "win")).toBe("Ctrl+K Ctrl+S");
	});

	it("maps named keys to their native labels", () => {
		expect(formatKeybinding("alt+pagedown", "linux")).toBe("Alt+PageDown");
		expect(formatKeybinding("cmd+delete", "mac")).toBe("⌘Del");
		expect(formatKeybinding("f5", "win")).toBe("F5");
	});
});
