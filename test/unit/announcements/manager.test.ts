import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { AnnouncementManager } from "@/announcements/manager";
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

import type { AppearanceConfig } from "coder/site/src/api/typesGenerated";

const DEPLOYMENT = {
	url: "https://coder.example.com",
	safeHostname: "coder.example.com",
};

function createClient() {
	return { getAppearance: vi.fn<() => Promise<AppearanceConfig>>() };
}

type MockAppearanceClient = ReturnType<typeof createClient>;

let manager: AnnouncementManager | undefined;

function appearance(messages: readonly string[] = []): AppearanceConfig {
	return {
		application_name: "Coder",
		logo_url: "",
		docs_url: "",
		service_banner: { enabled: false },
		announcement_banners: messages.map((message) => ({
			enabled: true,
			message,
			background_color: "#004852",
		})),
	};
}

function setup() {
	const config = new MockConfigurationProvider();
	const client = createClient();
	client.getAppearance.mockResolvedValue(appearance());
	const session = new SessionStore();
	const secretsManager = new SecretsManager(
		new InMemorySecretStorage(),
		new InMemoryMemento(),
		createMockLogger(),
	);
	const statusBar = new MockStatusBarItem();
	const logger = createMockLogger();
	const announcementManager = new AnnouncementManager(
		client,
		session,
		secretsManager,
		logger,
	);
	manager = announcementManager;
	return {
		client,
		config,
		logger,
		manager: announcementManager,
		secretsManager,
		session,
		statusBar,
	};
}

async function signIn(session: SessionStore): Promise<void> {
	session.signIn(DEPLOYMENT, createMockUser());
	await flushPromises();
}

function nextAppearance(
	client: MockAppearanceClient,
	messages: readonly string[],
): void {
	client.getAppearance.mockResolvedValueOnce(appearance(messages));
}

function expectInfo(message: string, ...items: string[]): void {
	expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
		message,
		...items,
	);
}

describe("AnnouncementManager", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	afterEach(() => {
		manager?.dispose();
		manager = undefined;
	});

	it("shows all active banners in the status bar", async () => {
		const { client, session, statusBar } = setup();
		nextAppearance(client, ["First", "Second"]);

		await signIn(session);

		expect(statusBar.text).toBe("$(megaphone) Coder 2");
		expect(statusBar.tooltip).toContain("1. First");
		expect(statusBar.tooltip).toContain("2. Second");
		expect(statusBar.show).toHaveBeenCalled();
	});

	it("notifies only newly seen banners", async () => {
		const { client, manager, secretsManager, session } = setup();
		nextAppearance(client, ["First", "Second"]);
		await signIn(session);
		expectInfo("Coder has 2 new deployment announcements.", "View");
		vi.mocked(vscode.window.showInformationMessage).mockClear();

		nextAppearance(client, ["First", "Second", "Third"]);
		await manager.refresh({ notify: true });

		expectInfo("Coder announcement: Third", "View");
		expect(secretsManager.getSeenBanners(DEPLOYMENT.safeHostname)).toHaveLength(
			3,
		);
	});

	it("does not notify for banners already seen on the same deployment", async () => {
		const { client, manager, session } = setup();
		client.getAppearance.mockResolvedValue(appearance(["Maintenance tonight"]));
		await signIn(session);
		vi.mocked(vscode.window.showInformationMessage).mockClear();

		await manager.refresh({ notify: true });

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("suppresses popups when notifications are disabled but keeps status bar", async () => {
		const { client, config, session, statusBar } = setup();
		config.set("coder.disableNotifications", true);
		nextAppearance(client, ["Maintenance tonight"]);

		await signIn(session);

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		expect(statusBar.show).toHaveBeenCalled();
		expect(statusBar.text).toBe("$(megaphone) Coder");
	});

	it("shows newly seen banners on a different deployment", async () => {
		const { client, session } = setup();
		client.getAppearance.mockResolvedValue(appearance(["Maintenance tonight"]));
		await signIn(session);
		vi.mocked(vscode.window.showInformationMessage).mockClear();

		session.signIn(
			{ url: "https://other.example.com", safeHostname: "other.example.com" },
			createMockUser(),
		);
		await flushPromises();

		expectInfo("Coder announcement: Maintenance tonight", "View");
	});

	it("refreshes before showing announcements from the command", async () => {
		const { client, manager, session } = setup();
		client.getAppearance.mockResolvedValue(appearance(["Full details"]));
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
			[
				expect.objectContaining({
					label: "$(megaphone) Announcement 1",
					detail: "Full details",
				}),
			],
			expect.objectContaining({ title: "Coder Announcements" }),
		);
		expectInfo("Full details");
	});

	it("shows an empty message when there are no active announcements", async () => {
		const { manager, session } = setup();
		await signIn(session);
		vi.mocked(vscode.window.showInformationMessage).mockClear();

		await manager.showAnnouncements();

		expectInfo("No active Coder announcements.");
	});

	it("shows refresh errors from the command", async () => {
		const { client, logger, manager, session } = setup();
		await signIn(session);
		vi.mocked(vscode.window.showInformationMessage).mockClear();
		client.getAppearance.mockRejectedValueOnce(new Error("boom"));

		await manager.showAnnouncements();

		expect(logger.warn).toHaveBeenCalledWith(
			"Failed to refresh Coder announcements",
			expect.any(Error),
		);
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Failed to refresh Coder announcements: boom",
		);
		expectInfo("No active Coder announcements.");
	});

	it("opens the announcements command from the popup action", async () => {
		const { client, manager, session } = setup();
		nextAppearance(client, ["Maintenance tonight"]);
		const showAnnouncements = vi
			.spyOn(manager, "showAnnouncements")
			.mockResolvedValue();
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
			"View" as never,
		);

		await signIn(session);
		await flushPromises();

		expect(showAnnouncements).toHaveBeenCalledOnce();
	});

	it("ignores stale refreshes after the session changes", async () => {
		const { client, session, statusBar } = setup();
		const stale = Promise.withResolvers<AppearanceConfig>();
		client.getAppearance
			.mockReturnValueOnce(stale.promise)
			.mockResolvedValueOnce(appearance(["Current"]));

		session.signIn(DEPLOYMENT, createMockUser());
		await Promise.resolve();
		session.signIn(
			{ url: "https://other.example.com", safeHostname: "other.example.com" },
			createMockUser(),
		);
		stale.resolve(appearance(["Stale"]));
		await flushPromises();

		expect(statusBar.tooltip).toContain("Current");
		expect(statusBar.tooltip).not.toContain("Stale");
	});

	it("polls for new banners while signed in and stops after sign-out", async () => {
		vi.useFakeTimers();
		const { client, session, statusBar } = setup();
		await signIn(session);
		nextAppearance(client, ["Scheduled maintenance"]);

		await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
		await flushPromises();

		expect(statusBar.text).toBe("$(megaphone) Coder");
		expectInfo("Coder announcement: Scheduled maintenance", "View");

		session.signOut(null);
		client.getAppearance.mockClear();
		await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

		expect(client.getAppearance).not.toHaveBeenCalled();
	});

	it("clears status bar when signed out", async () => {
		const { client, session, statusBar } = setup();
		nextAppearance(client, ["Maintenance tonight"]);
		await signIn(session);
		statusBar.hide.mockClear();

		session.signOut(null);

		expect(statusBar.hide).toHaveBeenCalledOnce();
	});
});
