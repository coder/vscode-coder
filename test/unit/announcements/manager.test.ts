import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as vscode from "vscode";

import {
	AnnouncementManager,
	REFRESH_INTERVAL_MS,
} from "@/announcements/manager";
import { MementoManager } from "@/core/mementoManager";
import { SessionStore } from "@/deployment/sessionStore";

import {
	createMockLogger,
	createMockUser,
	flushPromises,
	InMemoryMemento,
	MockConfigurationProvider,
	MockProgressReporter,
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
	new MockProgressReporter();
	const config = new MockConfigurationProvider();
	const client = { getAppearance: vi.fn<() => Promise<AppearanceConfig>>() };
	client.getAppearance.mockResolvedValue(appearance());
	const session = new SessionStore();
	const mementoManager = new MementoManager(new InMemoryMemento());
	const statusBar = new MockStatusBarItem();
	const logger = createMockLogger();
	const manager = new AnnouncementManager(
		client,
		session,
		mementoManager,
		logger,
	);
	onTestFinished(() => manager.dispose());
	return {
		client,
		config,
		logger,
		manager,
		mementoManager,
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

function tooltipMarkdown(statusBar: MockStatusBarItem): string {
	expect(statusBar.tooltip).toBeInstanceOf(vscode.MarkdownString);
	return (statusBar.tooltip as vscode.MarkdownString).value;
}

/** Content currently registered for the "markdown.showPreview" virtual document. */
function previewContent(): string | undefined {
	const provider = vi
		.mocked(vscode.workspace.registerTextDocumentContentProvider)
		.mock.calls.at(-1)?.[1];
	return provider?.provideTextDocumentContent(
		{} as vscode.Uri,
		{} as vscode.CancellationToken,
	) as string | undefined;
}

function expectPreviewShown(): void {
	expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
		"markdown.showPreview",
		expect.objectContaining({ scheme: "coder-announcements" }),
	);
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
		expect(tooltipMarkdown(statusBar)).toContain("First");
		expect(tooltipMarkdown(statusBar)).toContain("Second");
		expect(statusBar.show).toHaveBeenCalled();
	});

	it("notifies only newly seen banners", async () => {
		const { client, manager, mementoManager, session } = setup();
		nextAppearance(client, ["First", "Second"]);
		await signIn(session);
		expectInfo("Coder has 2 new deployment announcements.", "View");
		clearInfoMessages();

		nextAppearance(client, ["First", "Second", "Third"]);
		await manager.refresh({ notify: true });

		expectInfo("Coder has a new deployment announcement.", "View");
		expect(
			mementoManager.getSurfacedBanners(deployment().safeHostname),
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
		const { client, config, manager, mementoManager, session, statusBar } =
			setup();
		config.set("coder.disableNotifications", true);
		client.getAppearance.mockResolvedValue(appearance(["Maintenance tonight"]));

		await signIn(session);

		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		expect(statusBar.show).toHaveBeenCalled();
		expect(statusBar.text).toBe("$(megaphone) Coder");
		expect(
			mementoManager.getSurfacedBanners(deployment().safeHostname),
		).toEqual([]);
		expect(statusBar.backgroundColor).toEqual(
			new vscode.ThemeColor("statusBarItem.warningBackground"),
		);

		config.set("coder.disableNotifications", false);
		await manager.refresh({ notify: true });

		expectInfo("Coder has a new deployment announcement.", "View");
		expect(statusBar.backgroundColor).toBeUndefined();
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

		expectInfo("Coder has a new deployment announcement.", "View");
	});

	it("keeps showing the current banners while a re-triggered sign-in refreshes them", async () => {
		const { client, session, statusBar } = setup();
		nextAppearance(client, ["Maintenance tonight"]);
		await signIn(session);
		expect(statusBar.text).toBe("$(megaphone) Coder");
		statusBar.hide.mockClear();

		// e.g. a token refresh re-firing signIn() for the same deployment.
		const pending = Promise.withResolvers<AppearanceConfig>();
		client.getAppearance.mockReturnValueOnce(pending.promise);
		session.signIn(deployment(), createMockUser());

		expect(statusBar.text).toBe("$(megaphone) Coder");
		expect(statusBar.hide).not.toHaveBeenCalled();

		pending.resolve(appearance(["Maintenance tonight"]));
		await flushPromises();
	});

	it("refreshes before showing announcements from the command", async () => {
		const { client, manager, session } = setup();
		nextAppearance(client, ["Old"]);
		await signIn(session);
		nextAppearance(client, ["Full details"]);

		await manager.showAnnouncements();

		expect(client.getAppearance).toHaveBeenCalledTimes(2);
		expectPreviewShown();
		expect(previewContent()).toContain("Full details");
		expect(previewContent()).not.toContain("Old");
	});

	it("shows a window progress indicator while loading announcements from the command", async () => {
		const { manager, session } = setup();
		await signIn(session);

		await manager.showAnnouncements();

		expect(vscode.window.withProgress).toHaveBeenCalledWith(
			expect.objectContaining({ location: vscode.ProgressLocation.Window }),
			expect.any(Function),
		);
	});

	it("debounces concurrent showAnnouncements calls into a single refresh", async () => {
		const { client, manager, session } = setup();
		await signIn(session);
		client.getAppearance.mockClear();
		nextAppearance(client, ["Full details"]);

		await Promise.all([
			manager.showAnnouncements(),
			manager.showAnnouncements(),
		]);

		expect(client.getAppearance).toHaveBeenCalledTimes(1);
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

	it("opens the preview from the popup action without refetching", async () => {
		const { client, session } = setup();
		nextAppearance(client, ["Maintenance tonight"]);
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
			"View" as never,
		);

		await signIn(session);
		await flushPromises();

		expectPreviewShown();
		expect(previewContent()).toContain("Maintenance tonight");
		expect(client.getAppearance).toHaveBeenCalledTimes(1);
	});

	it("does not open an empty preview when banners are cleared before the popup action resolves", async () => {
		const { client, session } = setup();
		nextAppearance(client, ["Maintenance tonight"]);
		const popupAction = Promise.withResolvers<string | undefined>();
		vi.mocked(vscode.window.showInformationMessage).mockReturnValueOnce(
			popupAction.promise as never,
		);

		await signIn(session);
		session.signOut(null);
		popupAction.resolve("View");
		await flushPromises();

		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
			"markdown.showPreview",
			expect.anything(),
		);
	});

	it("clears the attention color as soon as the preview is opened, even if the refresh that preceded it failed", async () => {
		const { client, config, manager, mementoManager, session, statusBar } =
			setup();
		config.set("coder.disableNotifications", true);
		client.getAppearance.mockResolvedValue(appearance(["Maintenance tonight"]));
		await signIn(session);
		expect(statusBar.backgroundColor).toEqual(
			new vscode.ThemeColor("statusBarItem.warningBackground"),
		);
		client.getAppearance.mockRejectedValueOnce(new Error("boom"));

		await manager.showAnnouncements();

		expectPreviewShown();
		expect(previewContent()).toContain("Maintenance tonight");
		expect(statusBar.backgroundColor).toBeUndefined();
		expect(
			mementoManager.getSurfacedBanners(deployment().safeHostname),
		).toHaveLength(1);
	});

	it("disposes the preview's content provider registration", () => {
		const { manager } = setup();
		const providerDisposable: vscode.Disposable | undefined = vi
			.mocked(vscode.workspace.registerTextDocumentContentProvider)
			.mock.results.at(-1)?.value;

		manager.dispose();

		expect(providerDisposable?.dispose).toHaveBeenCalled();
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

		expect(tooltipMarkdown(statusBar)).toContain("Current");
		expect(tooltipMarkdown(statusBar)).not.toContain("Stale");
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

		expect(tooltipMarkdown(statusBar)).toContain("Current");
		expect(tooltipMarkdown(statusBar)).not.toContain("Stale");
	});

	it("polls for new banners while signed in and stops after sign-out", async () => {
		vi.useFakeTimers();
		const { client, session, statusBar } = setup();
		await signIn(session);
		nextAppearance(client, ["Scheduled maintenance"]);

		await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
		await flushPromises();

		expect(statusBar.text).toBe("$(megaphone) Coder");
		expectInfo("Coder has a new deployment announcement.", "View");

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
