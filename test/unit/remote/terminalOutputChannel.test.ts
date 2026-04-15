import { describe, expect, it, vi, beforeEach } from "vitest";

import { TerminalOutputChannel } from "@/remote/terminalOutputChannel";

const mockAppend = vi.fn();

vi.mock("vscode", () => ({
	window: {
		createOutputChannel: vi.fn(() => ({
			append: mockAppend,
			show: vi.fn(),
			dispose: vi.fn(),
		})),
	},
}));

describe("TerminalOutputChannel", () => {
	beforeEach(() => {
		mockAppend.mockClear();
	});

	it("strips \\r from \\r\\n line endings", () => {
		const channel = new TerminalOutputChannel("test");
		channel.write("hello\r\nworld\r\n");
		expect(mockAppend).toHaveBeenCalledWith("hello\nworld\n");
	});

	it("strips bare \\r characters", () => {
		const channel = new TerminalOutputChannel("test");
		channel.write("progress\r50%\r100%\n");
		expect(mockAppend).toHaveBeenCalledWith("progress50%100%\n");
	});

	it("passes plain text through unchanged", () => {
		const channel = new TerminalOutputChannel("test");
		channel.write("no special chars");
		expect(mockAppend).toHaveBeenCalledWith("no special chars");
	});
});
