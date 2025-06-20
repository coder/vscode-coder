import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { Storage } from "./storage";

// Mock dependencies
vi.mock("vscode");
vi.mock("./headers");
vi.mock("./api-helper");
vi.mock("./cliManager");

describe("storage", () => {
	it("should create Storage instance", () => {
		const mockOutput = {} as vscode.OutputChannel;
		const mockMemento = {} as vscode.Memento;
		const mockSecrets = {} as vscode.SecretStorage;
		const mockGlobalStorageUri = {} as vscode.Uri;
		const mockLogUri = {} as vscode.Uri;

		const storage = new Storage(
			mockOutput,
			mockMemento,
			mockSecrets,
			mockGlobalStorageUri,
			mockLogUri,
		);

		expect(storage).toBeInstanceOf(Storage);
	});
});
