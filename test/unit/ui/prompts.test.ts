import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { OAuthMetadataClient, type OAuthSupport } from "@/oauth/metadataClient";
import { MementoManager } from "@/storage/mementoManager";
import { maybeAskAuthMethod, maybeAskUrl } from "@/ui/prompts";

import {
	createMockLogger,
	INVALID_DEPLOYMENT_URLS,
	InMemoryMemento,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";

vi.mock("@/ui/progress", () => ({
	withProgress: (_options: unknown, fn: () => Promise<unknown>) => fn(),
}));

const client = { getAxiosInstance: vi.fn() } as unknown as CoderApi;

describe("maybeAskAuthMethod", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		new MockConfigurationProvider().set("coder.oauth.enabled", true);
	});

	function mockSupport(support: OAuthSupport) {
		vi.spyOn(OAuthMetadataClient, "checkOAuthSupport").mockResolvedValue(
			support,
		);
	}

	it("signs in with a token and explains why when registration is disabled", async () => {
		mockSupport("registration_disabled");

		expect(await maybeAskAuthMethod(client, createMockLogger())).toBe("legacy");
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			expect.stringContaining("dynamic client registration is disabled"),
		);
	});

	it("signs in with a token without a notice when OAuth is unsupported", async () => {
		mockSupport("unsupported");

		expect(await maybeAskAuthMethod(client, createMockLogger())).toBe("legacy");
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
	});

	it.each([
		{ enabled: undefined, oldEnabled: undefined, expected: "legacy" },
		{ enabled: undefined, oldEnabled: false, expected: "legacy" },
		{ enabled: undefined, oldEnabled: true, expected: "oauth" },
		{ enabled: false, oldEnabled: true, expected: "legacy" },
		{ enabled: true, oldEnabled: false, expected: "oauth" },
	])(
		"uses $expected with new=$enabled and old=$oldEnabled",
		async ({ enabled, oldEnabled, expected }) => {
			const config = new MockConfigurationProvider();
			config.setDefault("coder.oauth.enabled", false);
			config.set("coder.oauth.enabled", enabled);
			config.set("coder.experimental.oauth", oldEnabled);
			mockSupport("supported");
			vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
				label: "OAuth (Recommended)",
				value: "oauth",
			} as vscode.QuickPickItem);

			expect(await maybeAskAuthMethod(client, createMockLogger())).toBe(
				expected,
			);
			expect(OAuthMetadataClient.checkOAuthSupport).toHaveBeenCalledTimes(
				expected === "oauth" ? 1 : 0,
			);
		},
	);

	it("asks for the method when OAuth is supported", async () => {
		mockSupport("supported");
		vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
			label: "OAuth (Recommended)",
			value: "oauth",
		} as vscode.QuickPickItem);

		expect(await maybeAskAuthMethod(client, createMockLogger())).toBe("oauth");
	});
});

describe("maybeAskUrl", () => {
	const mementoManager = new MementoManager(new InMemoryMemento());

	it.each([
		["coder.example.com/", "https://coder.example.com"],
		["https://coder.example.com/base/", "https://coder.example.com/base"],
		["https://bücher.example", "https://xn--bcher-kva.example"],
	])("normalizes %j to %j", async (input, expected) => {
		await expect(maybeAskUrl(mementoManager, input)).resolves.toBe(expected);
	});

	it.each([...INVALID_DEPLOYMENT_URLS, "host/'; id; '"])(
		"rejects %j before sign-in",
		async (url) => {
			await expect(maybeAskUrl(mementoManager, url)).rejects.toThrow(
				/Invalid URL/,
			);
		},
	);
});
