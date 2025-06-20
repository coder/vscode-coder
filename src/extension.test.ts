import { describe, it, expect, vi } from "vitest";
import * as extension from "./extension";

// Mock dependencies
vi.mock("vscode");
vi.mock("axios");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./commands");
vi.mock("./error");
vi.mock("./remote");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspacesProvider");

describe("extension", () => {
	it("should export activate function", () => {
		expect(typeof extension.activate).toBe("function");
	});

	// Note: deactivate function is not exported from extension.ts
});
