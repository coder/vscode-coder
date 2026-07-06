import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as vscode from "vscode";

import {
	AnnouncementManager,
	REFRESH_INTERVAL_MS,
} from "@/announcements/manager";
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

function deployment(host = "coder.example.com") {
	return { url: `https://${host}`, safeHostname: host };
}

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
	const client = { getAppearance: vi.fn<() => Promise<AppearanceConfig>>() };
	client.getAppearance.mockResolvedValue(appearance());
	const session = new SessionStore();
	const secretsManager = new SecretsManager(
		new InMemorySecretStorage(),
		new InMemoryMemento(),
		createMockLogger(),
	);
	const statusBar = new MockStatusBarItem();
	const logger = createMockLogger();
	const manager = new AnnouncementManager(
		client,
		session,
		secretsManager,
		logger,
	);
	onTestFinished(() => manager.dispose());
	return {
		client,
		config,
		logger,
		manager,
		secretsManager,
		session,
		statusBar,
	};
}

type MockAppearanceClient = ReturnType<typeof setup>["client"];

function signIn(session: SessionStore, host?: string): Promise<void> {
	session.signIn(deployment(host), createMockUser());
	return flushPromises();
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

function clearInfoMessages(): void {
	vi.mocked(vscode.window.showInformationMessage).mockClear();
}

describe("AnnouncementManager", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
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
		clearInfoMessages();

		nextAppearance(client, ["First", "Second", "Third"]);
		await manager.refresh({ notify: true });

		expectInfo("Coder announcement: Third", "View");
		expect(
			secretsManager.getSeenBanners(deployment().safeHostname),
		).toHaveLength(3);
	});

	it("does not notify for banners already seen on the same deployment", async () => {
		const { client, manager, session } = setup();
		client.getAppearance.mockResolvedValue(appearance(["Maintenance tonight"]));
		await signIn(session);
		clearInfoMessages();

		await manager.refresh({ notify: true });

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("suppresses popups when notifications are disabled without marking banners seen", async () => {
		const { client, config, manager, secretsManager, session, statusBar } =
			setup();
		config.set("coder.disableNotifications", true);
		client.getAppearance.mockResolvedValue(appearance(["Maintenance tonight"]));

		await signIn(session);

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		expect(statusBar.show).toHaveBeenCalled();
		expect(statusBar.text).toBe("$(megaphone) Coder");
		expect(secretsManager.getSeenBanners(deployment().safeHostname)).toEqual(
			[],
		);

		config.set("coder.disableNotifications", false);
		await manager.refresh({ notify: true });

		expectInfo("Coder announcement: Maintenance tonight", "View");
	});

	it("does not re-notify banners that temporarily disappear", async () => {
		const { client, manager, session } = setup();
		nextAppearance(client, ["Maintenance tonight"]);
		await signIn(session);
		clearInfoMessages();

		nextAppearance(client, []);
		await manager.refresh({ notify: true });
		nextAppearance(client, ["Maintenance tonight"]);
		await manager.refresh({ notify: true });

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("shows newly seen banners on a different deployment", async () => {
		const { client, session } = setup();
		client.getAppearance.mockResolvedValue(appearance(["Maintenance tonight"]));
		await signIn(session);
		clearInfoMessages();

		await signIn(session, "other.example.com");

		expectInfo("Coder announcement: Maintenance tonight", "View");
	});

	it("refreshes before showing announcements from the command", async () => {
		const { client, manager, session } = setup();
		client.getAppearance.mockResolvedValue(appearance(["Full details"]));
		vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(
			async (items) => (await items)[0],
		);
		await signIn(session);
		clearInfoMessages();

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
		clearInfoMessages();

		await manager.showAnnouncements();

		expectInfo("No active Coder announcements.");
	});

	it("shows refresh errors from the command", async () => {
		const { client, logger, manager, session } = setup();
		await signIn(session);
		clearInfoMessages();
		client.getAppearance.mockRejectedValueOnce(new Error("boom"));

		await manager.showAnnouncements();

		expect(logger.warn).toHaveBeenCalledWith(
			"Failed to refresh Coder announcements",
			expect.any(Error),
		);
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Failed to refresh Coder announcements: boom",
		);
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("opens the picker from the popup action without refetching", async () => {
		const { client, session } = setup();
		nextAppearance(client, ["Maintenance tonight"]);
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
			"View" as never,
		);

		await signIn(session);
		await flushPromises();

		expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
			[expect.objectContaining({ detail: "Maintenance tonight" })],
			expect.objectContaining({ title: "Coder Announcements" }),
		);
		expect(client.getAppearance).toHaveBeenCalledTimes(1);
	});

	it("ignores stale responses from an overlapping refresh", async () => {
		const { client, manager, session, statusBar } = setup();
		await signIn(session);
		const stale = Promise.withResolvers<AppearanceConfig>();
		client.getAppearance.mockReturnValueOnce(stale.promise);

		const slowRefresh = manager.refresh();
		nextAppearance(client, ["Current"]);
		await manager.refresh();
		stale.resolve(appearance(["Stale"]));
		await slowRefresh;

		expect(statusBar.tooltip).toContain("Current");
		expect(statusBar.tooltip).not.toContain("Stale");
	});

	it("ignores stale refreshes after the session changes", async () => {
		const { client, session, statusBar } = setup();
		const stale = Promise.withResolvers<AppearanceConfig>();
		client.getAppearance
			.mockReturnValueOnce(stale.promise)
			.mockResolvedValueOnce(appearance(["Current"]));

		session.signIn(deployment(), createMockUser());
		await Promise.resolve();
		session.signIn(deployment("other.example.com"), createMockUser());
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

		await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
		await flushPromises();

		expect(statusBar.text).toBe("$(megaphone) Coder");
		expectInfo("Coder announcement: Scheduled maintenance", "View");

		session.signOut(null);
		client.getAppearance.mockClear();
		await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);

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
