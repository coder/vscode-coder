import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { ZodError } from "zod";

import {
	runDiagnosticCli,
	type DiagnosticCliOptions,
} from "@/command/diagnosticFlow";

import { createMockLogger } from "../../mocks/testHelpers";

import type { DiagnosticTrace } from "@/instrumentation/diagnostics";

function setup() {
	vi.clearAllMocks();
	// Run the task with a non-cancelled token, like the real progress UI.
	vi.mocked(vscode.window.withProgress).mockImplementation(
		async (_opts, task) =>
			task(
				{ report: vi.fn() },
				{
					isCancellationRequested: false,
					onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
				},
			),
	);
	// The action handler chains off the returned thenable, so it must resolve.
	vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);

	const telemetry: DiagnosticTrace = {
		abort: vi.fn(),
		error: vi.fn(),
		setRequestedDuration: vi.fn(),
		succeedSpeedtest: vi.fn(),
		succeedExport: vi.fn(),
		succeedNetcheck: vi.fn(),
	};
	const display = vi.fn();

	const run = (over: Partial<DiagnosticCliOptions> = {}) =>
		runDiagnosticCli({
			telemetry,
			logger: createMockLogger(),
			name: "Network check",
			progressTitle: "Running network check",
			exec: () => Promise.resolve("{}"),
			parseAndDisplay: display,
			...over,
		});

	return { telemetry, display, run };
}

const abortError = () => {
	const err = new Error("cancelled");
	err.name = "AbortError";
	return err;
};

describe("runDiagnosticCli", () => {
	it("records an abort and skips display when the run is cancelled", async () => {
		const { telemetry, display, run } = setup();

		await run({ exec: () => Promise.reject(abortError()) });

		expect(telemetry.abort).toHaveBeenCalledWith("progress");
		expect(telemetry.error).not.toHaveBeenCalled();
		expect(display).not.toHaveBeenCalled();
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
	});

	it("records an error and reports the failure when the CLI fails", async () => {
		const { telemetry, run } = setup();

		await run({ exec: () => Promise.reject(new Error("boom")) });

		expect(telemetry.error).toHaveBeenCalledWith();
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Network check failed: boom",
		);
	});

	it("maps a parse failure to parse_error and offers the raw output", async () => {
		const { telemetry, run } = setup();

		await run({
			parseAndDisplay: () => {
				throw new ZodError([]);
			},
		});

		expect(telemetry.error).toHaveBeenCalledWith("parse_error");
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("did not match the expected format"),
			"View Output",
		);
	});

	it("treats a SyntaxError as a parse failure", async () => {
		const { telemetry, run } = setup();

		await run({
			parseAndDisplay: () => {
				throw new SyntaxError("Unexpected token");
			},
		});

		expect(telemetry.error).toHaveBeenCalledWith("parse_error");
	});

	it("maps a non-parse display failure to a generic error", async () => {
		const { telemetry, run } = setup();

		await run({
			parseAndDisplay: () => {
				throw new Error("panel disposed");
			},
		});

		expect(telemetry.error).toHaveBeenCalledWith();
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Network check could not display its results: panel disposed",
			"View Output",
		);
	});

	it("opens the raw output in an editor when the user picks View Output", async () => {
		const { run } = setup();
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(
			"View Output" as unknown as undefined,
		);
		vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
			{} as vscode.TextDocument,
		);
		vi.mocked(vscode.window.showTextDocument).mockResolvedValue(
			{} as vscode.TextEditor,
		);

		await run({
			exec: () => Promise.resolve("RAW-OUTPUT"),
			parseAndDisplay: () => {
				throw new SyntaxError("bad");
			},
		});

		await vi.waitFor(() =>
			expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({
				content: "RAW-OUTPUT",
				language: "json",
			}),
		);
		expect(vscode.window.showTextDocument).toHaveBeenCalled();
	});

	it("displays the parsed output on success without recording an error", async () => {
		const { telemetry, display, run } = setup();

		await run({ exec: () => Promise.resolve('{"ok":true}') });

		expect(display).toHaveBeenCalledWith('{"ok":true}');
		expect(telemetry.error).not.toHaveBeenCalled();
		expect(telemetry.abort).not.toHaveBeenCalled();
	});
});
