import { Api } from "coder/site/src/api/api";
import { Workspace } from "coder/site/src/api/typesGenerated";
import { ProxyAgent } from "proxy-agent";
import { describe, it, expect, vi } from "vitest";
import { Inbox } from "./inbox";
import { Storage } from "./storage";

// Mock dependencies
vi.mock("vscode");
vi.mock("ws");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./storage");

describe("inbox", () => {
	it("should create Inbox instance", () => {
		const mockWorkspace = {} as Workspace;
		const mockHttpAgent = {} as ProxyAgent;
		const mockRestClient = {} as Api;
		const mockStorage = {} as Storage;

		const inbox = new Inbox(
			mockWorkspace,
			mockHttpAgent,
			mockRestClient,
			mockStorage,
		);

		expect(inbox).toBeInstanceOf(Inbox);
		expect(typeof inbox.dispose).toBe("function");
	});
});
