import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { TerminalOutputChannel } from "@/remote/terminalOutputChannel";

import { MockOutputChannel } from "../../mocks/testHelpers";

vi.mocked(vscode.window.createOutputChannel).mockImplementation(
	(name: string) => new MockOutputChannel(name),
);

function setup(input: string): MockOutputChannel {
	const channel = new TerminalOutputChannel("test");
	channel.write(input);
	return vi.mocked(vscode.window.createOutputChannel).mock.results.at(-1)!
		.value as MockOutputChannel;
}

describe("TerminalOutputChannel", () => {
	it.each([
		["converts \\r\\n to \\n", "hello\r\nworld\r\n", "hello\nworld\n"],
		["strips bare \\r", "progress\r50%\r100%\n", "progress50%100%\n"],
		["strips ANSI escape sequences", "\x1b[0;1mBold\x1b[0m text", "Bold text"],
		["strips ANSI color codes", "\x1b[32m✔ Success\x1b[0m\r\n", "✔ Success\n"],
		["passes plain text unchanged", "hello world", "hello world"],
		["handles empty string", "", ""],
	])("%s", (_label, input, expected) => {
		expect(setup(input).content.join("")).toBe(expected);
	});

	it("does not create the channel until first write", () => {
		vi.mocked(vscode.window.createOutputChannel).mockClear();
		const channel = new TerminalOutputChannel("test");
		expect(vscode.window.createOutputChannel).not.toHaveBeenCalled();

		channel.write("hello");
		expect(vscode.window.createOutputChannel).toHaveBeenCalledOnce();
	});
});
