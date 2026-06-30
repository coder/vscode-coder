import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	AnnouncementBannerManager,
	getBannerKey,
	normalizeAnnouncementBanners,
} from "@/announcements/announcementBanners";
import { SecretsManager } from "@/core/secretsManager";
import { SessionStore } from "@/deployment/sessionStore";

import {
	createMockLogger,
	createMockUser,
	flushPromises,
	InMemoryMemento,
	InMemorySecretStorage,
	MockConfigurationProvider,
	MockStatusBarItem,
} from "../../mocks/testHelpers";

import type {
	AppearanceConfig,
	BannerConfig,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";

const DEPLOYMENT = {
	url: "https://coder.example.com",
	safeHostname: "coder.example.com",
};

function banner(overrides: Partial<BannerConfig> = {}): BannerConfig {
	return {
		enabled: true,
		message: "Maintenance tonight",
		background_color: "#004852",
		...overrides,
	};
}

function appearance(
	overrides: Partial<AppearanceConfig> = {},
): AppearanceConfig {
	return {
		application_name: "Coder",
		logo_url: "",
		docs_url: "",
		service_banner: { enabled: false },
		announcement_banners: [],
		...overrides,
	};
}

class MockAppearanceClient {
	readonly getAppearance = vi.fn<() => Promise<AppearanceConfig>>();
}

function setup() {
	const config = new MockConfigurationProvider();
	const client = new MockAppearanceClient();
	client.getAppearance.mockResolvedValue(appearance());
	const session = new SessionStore();
	const secretsManager = new SecretsManager(
		new InMemorySecretStorage(),
		new InMemoryMemento(),
		createMockLogger(),
	);
	const statusBar = new MockStatusBarItem();
	const logger = createMockLogger();
	const manager = new AnnouncementBannerManager(
		client as unknown as CoderApi,
		session,
		secretsManager,
		logger,
	);
	return {
		config,
		client,
		logger,
		manager,
		secretsManager,
		session,
		statusBar,
	};
}

async function signIn(session: SessionStore): Promise<void> {
	session.signIn(DEPLOYMENT, createMockUser());
	await flushPromises();
}

describe("normalizeAnnouncementBanners", () => {
	it("returns active service and announcement banners", () => {
		const banners = normalizeAnnouncementBanners(
			appearance({
				service_banner: banner({ message: "Service banner" }),
				announcement_banners: [
					banner({ message: "Announcement" }),
					banner({ enabled: false, message: "Disabled" }),
					banner({ message: "   " }),
				],
			}),
		);

		expect(banners.map((b) => [b.source, b.message])).toEqual([
			["service", "Service banner"],
			["announcement", "Announcement"],
		]);
	});

	it("keys ignore order but change when content changes", () => {
		const key = getBannerKey({
			source: "announcement",
			message: "Maintenance tonight",
			backgroundColor: "#004852",
		});

		expect(
			getBannerKey({
				source: "announcement",
				message: "Maintenance tonight",
				backgroundColor: "#004852",
			}),
		).toBe(key);
		expect(
			getBannerKey({
				source: "announcement",
				message: "Maintenance tomorrow",
				backgroundColor: "#004852",
			}),
		).not.toBe(key);
	});
});

describe("AnnouncementBannerManager", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("shows all active banners in the status bar", async () => {
		const { client, session, statusBar } = setup();
		client.getAppearance.mockResolvedValueOnce(
			appearance({
				announcement_banners: [
					banner({ message: "First" }),
					banner({ message: "Second" }),
				],
			}),
		);

		await signIn(session);

		expect(statusBar.text).toBe("$(megaphone) Coder 2");
		expect(statusBar.tooltip).toContain("1. First");
		expect(statusBar.tooltip).toContain("2. Second");
		expect(statusBar.show).toHaveBeenCalled();
	});

	it("notifies only newly seen banners", async () => {
		const { client, manager, secretsManager, session } = setup();
		client.getAppearance.mockResolvedValueOnce(
			appearance({
				announcement_banners: [
					banner({ message: "First" }),
					banner({ message: "Second" }),
				],
			}),
		);
		await signIn(session);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Coder has 2 new deployment announcements.",
			"View",
		);
		vi.mocked(vscode.window.showInformationMessage).mockClear();

		client.getAppearance.mockResolvedValueOnce(
			appearance({
				announcement_banners: [
					banner({ message: "First" }),
					banner({ message: "Second" }),
					banner({ message: "Third" }),
				],
			}),
		);
		await manager.refresh({ notify: true });

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Coder announcement: Third",
			"View",
		);
		expect(secretsManager.getSeenBanners(DEPLOYMENT.safeHostname)).toHaveLength(
			3,
		);
	});

	it("does not notify for banners already seen on the same deployment", async () => {
		const { client, manager, session } = setup();
		client.getAppearance.mockResolvedValue(
			appearance({ announcement_banners: [banner()] }),
		);
		await signIn(session);
		vi.mocked(vscode.window.showInformationMessage).mockClear();

		await manager.refresh({ notify: true });

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("suppresses popups when notifications are disabled but keeps status bar", async () => {
		const { client, config, session, statusBar } = setup();
		config.set("coder.disableNotifications", true);
		client.getAppearance.mockResolvedValueOnce(
			appearance({ announcement_banners: [banner()] }),
		);

		await signIn(session);

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		expect(statusBar.show).toHaveBeenCalled();
		expect(statusBar.text).toBe("$(megaphone) Coder");
	});

	it("shows newly seen banners on a different deployment", async () => {
		const { client, session } = setup();
		client.getAppearance.mockResolvedValue(
			appearance({ announcement_banners: [banner()] }),
		);

		session.signIn(DEPLOYMENT, createMockUser());
		await Promise.resolve();
		vi.mocked(vscode.window.showInformationMessage).mockClear();

		session.signIn(
			{ url: "https://other.example.com", safeHostname: "other.example.com" },
			createMockUser(),
		);
		await flushPromises();

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Coder announcement: Maintenance tonight",
			"View",
		);
	});

	it("refreshes before showing announcements from the command", async () => {
		const { client, manager, session } = setup();
		client.getAppearance.mockResolvedValue(
			appearance({
				announcement_banners: [banner({ message: "Full details" })],
			}),
		);
		vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
			label: "$(megaphone) Announcement 1",
			detail: "Full details",
			banner: {
				source: "announcement",
				message: "Full details",
				backgroundColor: "#004852",
				key: "key",
			},
		} as never);
		await signIn(session);
		vi.mocked(vscode.window.showInformationMessage).mockClear();

		await manager.showAnnouncements();

		expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
			[expect.objectContaining({ detail: "Full details" })],
			expect.objectContaining({ title: "Coder Announcements" }),
		);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Full details",
		);
	});

	it("clears status bar when signed out", async () => {
		const { client, session, statusBar } = setup();
		client.getAppearance.mockResolvedValueOnce(
			appearance({ announcement_banners: [banner()] }),
		);
		await signIn(session);

		session.signOut(null);

		expect(statusBar.hide).toHaveBeenCalled();
	});
});
