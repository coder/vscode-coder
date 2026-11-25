import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as vscode from "vscode";

import { SessionStore } from "@/deployment/sessionStore";
import {
	McpServerProvider,
	registerMcpServerProvider,
} from "@/mcp/mcpServerProvider";

import {
	createMockLogger,
	createMockUser,
	flushPromises,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { AxiosInstance } from "axios";
import type { Experiment } from "coder/site/src/api/typesGenerated";

const METADATA_PATH =
	"/.well-known/oauth-protected-resource/api/experimental/mcp/http";

function deployment(host = "coder.example.com") {
	return { url: `https://${host}`, safeHostname: host };
}

function setup() {
	const config = new MockConfigurationProvider();
	const get = vi.fn<(url: string) => Promise<unknown>>();
	get.mockResolvedValue({ status: 200 });
	const client = {
		getExperiments: vi.fn<() => Promise<Experiment[]>>(),
		getAxiosInstance: () => ({ get }) as unknown as AxiosInstance,
	};
	client.getExperiments.mockResolvedValue(["mcp-server-http"]);
	const session = new SessionStore();
	const provider = new McpServerProvider(client, session, createMockLogger());
	const onChange = vi.fn();
	provider.onDidChangeMcpServerDefinitions(onChange);
	onTestFinished(() => provider.dispose());
	return { client, config, get, onChange, provider, session };
}

function serverUrls(provider: McpServerProvider): string[] {
	return provider
		.provideMcpServerDefinitions()
		.map((definition) => definition.uri.toString());
}

async function signIn(session: SessionStore, host?: string): Promise<void> {
	session.signIn(deployment(host), createMockUser());
	await flushPromises();
}

describe("McpServerProvider", () => {
	it("offers nothing while signed out", () => {
		const { provider } = setup();

		expect(provider.provideMcpServerDefinitions()).toEqual([]);
	});

	it("offers the deployment's MCP endpoint when both gates pass", async () => {
		const { get, onChange, provider, session } = setup();

		await signIn(session);

		expect(get).toHaveBeenCalledWith(METADATA_PATH);
		expect(serverUrls(provider)).toEqual([
			"https://coder.example.com/api/experimental/mcp/http",
		]);
		expect(provider.provideMcpServerDefinitions()[0].label).toBe("Coder");
		expect(onChange).toHaveBeenCalled();
	});

	it("offers nothing without the mcp-server-http experiment", async () => {
		const { client, get, provider, session } = setup();
		client.getExperiments.mockResolvedValue(["oauth2"]);

		await signIn(session);

		expect(get).not.toHaveBeenCalled();
		expect(provider.provideMcpServerDefinitions()).toEqual([]);
	});

	it("offers nothing when the OAuth2 provider is disabled", async () => {
		const { get, provider, session } = setup();
		get.mockRejectedValue(new Error("Request failed with status code 404"));

		await signIn(session);

		expect(provider.provideMcpServerDefinitions()).toEqual([]);
	});

	it("offers nothing when the experiments request fails", async () => {
		const { client, provider, session } = setup();
		client.getExperiments.mockRejectedValue(new Error("network"));

		await signIn(session);

		expect(provider.provideMcpServerDefinitions()).toEqual([]);
	});

	it("removes the server on sign-out", async () => {
		const { onChange, provider, session } = setup();
		await signIn(session);
		onChange.mockClear();

		session.signOut(deployment());
		await flushPromises();

		expect(provider.provideMcpServerDefinitions()).toEqual([]);
		expect(onChange).toHaveBeenCalledOnce();
	});

	it("switches to the new deployment's endpoint", async () => {
		const { provider, session } = setup();
		await signIn(session, "first.example.com");

		await signIn(session, "second.example.com");

		expect(serverUrls(provider)).toEqual([
			"https://second.example.com/api/experimental/mcp/http",
		]);
	});

	it("ignores a check that a deployment switch superseded", async () => {
		const { client, provider, session } = setup();
		let resolveFirst: (experiments: Experiment[]) => void = () => {};
		client.getExperiments.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFirst = resolve;
			}),
		);
		session.signIn(deployment("first.example.com"), createMockUser());
		client.getExperiments.mockResolvedValueOnce([]);
		await signIn(session, "second.example.com");

		resolveFirst(["mcp-server-http"]);
		await flushPromises();

		expect(provider.provideMcpServerDefinitions()).toEqual([]);
	});

	it("follows the coder.mcpServer.enabled setting", async () => {
		const { config, onChange, provider, session } = setup();
		await signIn(session);
		onChange.mockClear();

		config.set("coder.mcpServer.enabled", false);
		expect(provider.provideMcpServerDefinitions()).toEqual([]);

		config.set("coder.mcpServer.enabled", true);
		expect(serverUrls(provider)).toHaveLength(1);
		expect(onChange).toHaveBeenCalledTimes(2);
	});
});

describe("registerMcpServerProvider", () => {
	beforeEach(() => {
		vi.mocked(vscode.lm.registerMcpServerDefinitionProvider).mockClear();
	});

	it("registers the provider under the contributed id", () => {
		const registration = registerMcpServerProvider(
			{ getExperiments: vi.fn(), getAxiosInstance: vi.fn() },
			new SessionStore(),
			createMockLogger(),
		);
		onTestFinished(() => registration?.dispose());

		expect(registration).toBeDefined();
		expect(vscode.lm.registerMcpServerDefinitionProvider).toHaveBeenCalledWith(
			"coder",
			expect.any(McpServerProvider),
		);
	});

	it("returns undefined when the editor lacks the MCP API", () => {
		vi.mocked(
			vscode.lm.registerMcpServerDefinitionProvider,
		).mockImplementationOnce(() => {
			throw new TypeError("not a function");
		});

		const registration = registerMcpServerProvider(
			{ getExperiments: vi.fn(), getAxiosInstance: vi.fn() },
			new SessionStore(),
			createMockLogger(),
		);

		expect(registration).toBeUndefined();
	});
});
