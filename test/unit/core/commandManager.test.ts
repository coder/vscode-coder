import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	CODER_COMMAND_IDS,
	CommandManager,
	type CoderCommandId,
} from "@/core/commandManager";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import { MockConfigurationProvider } from "../../mocks/testHelpers";

interface Harness {
	manager: CommandManager;
	sink: TestSink;
}

function makeHarness(): Harness {
	new MockConfigurationProvider();
	const sink = new TestSink();
	return {
		manager: new CommandManager(createTestTelemetryService(sink)),
		sink,
	};
}

function getRegisteredCallback(
	id: CoderCommandId,
): (...args: unknown[]) => Thenable<unknown> {
	const match = vi
		.mocked(vscode.commands.registerCommand)
		.mock.calls.find(([cmdId]) => cmdId === id);
	if (!match) {
		throw new Error(`No registration captured for ${id}`);
	}
	return match[1] as (...args: unknown[]) => Thenable<unknown>;
}

describe("CommandManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("register", () => {
		it("invokes the handler with forwarded args and resolves with its return value", async () => {
			const { manager } = makeHarness();
			const handler = vi.fn((a: number, b: number) => a + b);

			manager.register("coder.refreshWorkspaces", handler);
			const result = await getRegisteredCallback("coder.refreshWorkspaces")(
				2,
				3,
			);

			expect(handler).toHaveBeenCalledWith(2, 3);
			expect(result).toBe(5);
		});

		it("throws synchronously for an unknown id", () => {
			const { manager } = makeHarness();

			expect(() =>
				manager.register(
					"coder.unknownThing" as CoderCommandId,
					() => undefined,
				),
			).toThrow(/Unknown coder command id/);
		});
	});

	describe("telemetry", () => {
		it("emits one command.invoked event with success and a numeric durationMs on success", async () => {
			const { manager, sink } = makeHarness();
			manager.register("coder.refreshWorkspaces", () => "ok");

			await getRegisteredCallback("coder.refreshWorkspaces")();

			expect(sink.events).toHaveLength(1);
			expect(sink.events[0]).toMatchObject({
				eventName: "command.invoked",
				properties: {
					command_id: "coder.refreshWorkspaces",
					result: "success",
				},
			});
			expect(typeof sink.events[0].measurements.durationMs).toBe("number");
		});

		it("emits command.invoked with error and rethrows when the handler throws", async () => {
			const { manager, sink } = makeHarness();
			const boom = new TypeError("boom");
			manager.register("coder.login", () => {
				throw boom;
			});

			await expect(getRegisteredCallback("coder.login")()).rejects.toBe(boom);

			expect(sink.events).toHaveLength(1);
			expect(sink.events[0]).toMatchObject({
				eventName: "command.invoked",
				properties: { command_id: "coder.login", result: "error" },
				error: { message: "boom", type: "TypeError" },
			});
		});
	});

	describe("disposal", () => {
		it("disposing the returned Disposable unregisters the command exactly once", () => {
			const innerDispose = vi.fn();
			vi.mocked(vscode.commands.registerCommand).mockReturnValueOnce({
				dispose: innerDispose,
			});

			const { manager } = makeHarness();
			const disposable = manager.register("coder.login", () => undefined);

			disposable.dispose();
			disposable.dispose();

			expect(innerDispose).toHaveBeenCalledTimes(1);
		});

		it("manager.dispose() unregisters every command it registered", () => {
			const inner1 = vi.fn();
			const inner2 = vi.fn();
			vi.mocked(vscode.commands.registerCommand)
				.mockReturnValueOnce({ dispose: inner1 })
				.mockReturnValueOnce({ dispose: inner2 });

			const { manager } = makeHarness();
			manager.register("coder.login", () => undefined);
			manager.register("coder.logout", () => undefined);

			manager.dispose();

			expect(inner1).toHaveBeenCalledTimes(1);
			expect(inner2).toHaveBeenCalledTimes(1);
		});
	});

	it("CODER_COMMAND_IDS matches the coder.* ids declared in package.json", () => {
		const pkgPath = join(__dirname, "../../../package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			contributes: { commands: Array<{ command: string }> };
		};
		const declared = pkg.contributes.commands
			.map((c) => c.command)
			.filter((id) => id.startsWith("coder."))
			.sort();
		const inUnion = [...CODER_COMMAND_IDS].sort();

		expect(inUnion).toEqual(declared);
	});
});
