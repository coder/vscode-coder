import * as vscode from "vscode";

import { errToStr } from "../api/api-helper";
import { withProgress } from "../progress";
import { areNotificationsDisabled } from "../settings/notifications";
import { createStatusBarItem } from "../util/statusBar";

import {
	type Announcement,
	hoverMarkdown,
	normalizeBanners,
	popupMessage,
	previewMarkdown,
	statusText,
} from "./banners";
import { AnnouncementsPreview } from "./preview";

import type { CoderApi } from "../api/coderApi";
import type { SecretsManager } from "../core/secretsManager";
import type { SessionState } from "../deployment/sessionStore";
import type { Logger } from "../logging/logger";

/** Background poll interval; sign-in and manual refresh happen immediately either way. */
export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const VIEW_ACTION = "View";

interface RefreshOptions {
	readonly notify?: boolean;
	readonly showErrors?: boolean;
}

/** Fetches, tracks, and surfaces Coder deployment announcement banners. */
export class AnnouncementManager implements vscode.Disposable {
	private readonly statusBarItem = createStatusBarItem("announcements");
	private readonly sessionChangeDisposable: vscode.Disposable;
	private readonly preview = new AnnouncementsPreview();
	#banners: readonly Announcement[] = [];
	private fetchGeneration = 0;
	private refreshTimeout: NodeJS.Timeout | undefined;
	private disposed = false;
	private loadingAnnouncements: Promise<void> | undefined;

	public constructor(
		private readonly client: Pick<CoderApi, "getAppearance">,
		private readonly sessionState: SessionState,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
	) {
		this.statusBarItem.command = "coder.viewAnnouncements";
		this.sessionChangeDisposable = this.sessionState.onDidChange(() => {
			this.onSessionChange();
		});
		this.onSessionChange();
	}

	/** Refreshes the banners; resolves false when the refresh failed. */
	public async refresh(options: RefreshOptions = {}): Promise<boolean> {
		if (this.disposed) {
			return false;
		}
		this.cancelRefresh();
		try {
			await this.fetch(options);
			return true;
		} catch (error) {
			this.logger.warn("Failed to refresh Coder announcements", error);
			if (options.showErrors) {
				void vscode.window.showErrorMessage(
					`Failed to refresh Coder announcements: ${errToStr(error)}`,
				);
			}
			return false;
		} finally {
			this.scheduleRefresh();
		}
	}

	/** Concurrent calls share one in-flight load, shown via a window progress indicator. */
	public showAnnouncements(): Promise<void> {
		this.loadingAnnouncements ??= this.loadAnnouncements().finally(() => {
			this.loadingAnnouncements = undefined;
		});
		return this.loadingAnnouncements;
	}

	private async loadAnnouncements(): Promise<void> {
		await withProgress(
			{
				location: vscode.ProgressLocation.Window,
				title: "Loading Coder announcements…",
			},
			async () => {
				const refreshed = await this.refresh({
					notify: false,
					showErrors: true,
				});
				if (this.banners.length > 0) {
					await this.showAnnouncementsPreview();
				} else if (refreshed) {
					// On failure the error popup is the whole story.
					void vscode.window.showInformationMessage(
						"No active Coder announcements.",
					);
				}
			},
		);
	}

	/** Releases listeners/timers and hides the status bar item. */
	public dispose(): void {
		this.disposed = true;
		this.cancelRefresh();
		this.sessionChangeDisposable.dispose();
		this.preview.dispose();
		this.banners = [];
		this.statusBarItem.dispose();
	}

	/** Re-fetches on sign-in; clears the display on sign-out. */
	private onSessionChange(): void {
		this.cancelRefresh();
		if (this.sessionState.current.kind !== "signedIn") {
			this.banners = [];
			return;
		}
		// Leaves current banners visible while refresh() below confirms them.
		void this.refresh({ notify: true });
	}

	/** Fetches the latest banners and reconciles popup/surfaced/attention state. */
	private async fetch(options: RefreshOptions): Promise<void> {
		const session = this.sessionState.current;
		if (session.kind !== "signedIn") {
			this.banners = [];
			return;
		}

		const generation = ++this.fetchGeneration;
		const appearance = await this.client.getAppearance();
		// A newer fetch or a session change supersedes this response.
		if (
			this.disposed ||
			generation !== this.fetchGeneration ||
			this.sessionState.current !== session
		) {
			return;
		}
		const banners = normalizeBanners(appearance);
		this.banners = banners;

		const surfacedKeys = new Set(
			this.secretsManager.getSurfacedBanners(session.deployment.safeHostname),
		);
		const newBanners = banners.filter(
			(banner) => !surfacedKeys.has(banner.key),
		);
		if (newBanners.length === 0) {
			this.setAttentionIndicator(false);
			return;
		}
		const notifiable = !areNotificationsDisabled(
			vscode.workspace.getConfiguration(),
		);
		if (options.notify && notifiable) {
			this.showPopup(newBanners);
		}
		// Marks banners as surfaced, not read; suppressed ones notify later.
		if (!options.notify || notifiable) {
			await this.tryMarkSurfaced(banners, surfacedKeys);
		} else {
			this.setAttentionIndicator(true);
		}
	}

	/** Like markSurfaced, but logs storage failures instead of throwing. */
	private async tryMarkSurfaced(
		banners: readonly Announcement[],
		knownSurfacedKeys?: ReadonlySet<string>,
	): Promise<void> {
		try {
			await this.markSurfaced(banners, knownSurfacedKeys);
		} catch (error) {
			this.logger.warn("Failed to mark Coder announcements as surfaced", error);
		}
	}

	/** Marks banners surfaced and clears the attention color; skips redundant writes. */
	private async markSurfaced(
		banners: readonly Announcement[],
		knownSurfacedKeys?: ReadonlySet<string>,
	): Promise<void> {
		const session = this.sessionState.current;
		if (session.kind !== "signedIn") {
			return;
		}
		const surfacedKeys =
			knownSurfacedKeys ??
			new Set(
				this.secretsManager.getSurfacedBanners(session.deployment.safeHostname),
			);
		const merged = new Set([
			...surfacedKeys,
			...banners.map((banner) => banner.key),
		]);
		if (merged.size > surfacedKeys.size) {
			await this.secretsManager.setSurfacedBanners(
				session.deployment.safeHostname,
				[...merged],
			);
		}
		this.setAttentionIndicator(false);
	}

	/** Toggles a warning background so unsurfaced banners stand out in the status bar. */
	private setAttentionIndicator(hasUnsurfaced: boolean): void {
		this.statusBarItem.backgroundColor = hasUnsurfaced
			? new vscode.ThemeColor("statusBarItem.warningBackground")
			: undefined;
	}

	/** The setter syncs the status bar so the two cannot drift apart. */
	private get banners(): readonly Announcement[] {
		return this.#banners;
	}

	private set banners(banners: readonly Announcement[]) {
		this.#banners = banners;
		if (banners.length === 0) {
			this.statusBarItem.hide();
			return;
		}
		this.statusBarItem.text = statusText(banners.length);
		this.statusBarItem.tooltip = new vscode.MarkdownString(
			hoverMarkdown(banners),
		);
		this.statusBarItem.show();
	}

	/** Non-modal messages may never settle, so chain instead of awaiting. */
	private showPopup(banners: readonly Announcement[]): void {
		Promise.resolve(
			vscode.window.showInformationMessage(popupMessage(banners), VIEW_ACTION),
		)
			.then((action) =>
				// Banners are seconds old; skip the refetch.
				action === VIEW_ACTION ? this.showAnnouncementsPreview() : undefined,
			)
			.catch((error) => {
				this.logger.warn("Failed to show Coder announcement popup", error);
			});
	}

	/** Skips the preview if banners were cleared (e.g. sign-out) before or during marking. */
	private async showAnnouncementsPreview(): Promise<void> {
		if (this.banners.length === 0) {
			return;
		}
		await this.tryMarkSurfaced(this.banners);
		if (this.banners.length === 0) {
			return;
		}
		try {
			await this.preview.show(previewMarkdown(this.banners));
		} catch (error) {
			this.logger.warn("Failed to show Coder announcements preview", error);
			void vscode.window.showErrorMessage(
				`Failed to show Coder announcements: ${errToStr(error)}`,
			);
		}
	}

	private scheduleRefresh(): void {
		if (
			this.disposed ||
			this.refreshTimeout ||
			this.sessionState.current.kind !== "signedIn"
		) {
			return;
		}
		this.refreshTimeout = setTimeout(() => {
			this.refreshTimeout = undefined;
			void this.refresh({ notify: true });
		}, REFRESH_INTERVAL_MS);
	}

	private cancelRefresh(): void {
		if (this.refreshTimeout) {
			clearTimeout(this.refreshTimeout);
			this.refreshTimeout = undefined;
		}
	}
}
