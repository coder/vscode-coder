import * as vscode from "vscode";

import { errToStr } from "../api/api-helper";
import { areNotificationsDisabled } from "../settings/notifications";
import { createStatusBarItem } from "../util/statusBar";

import {
	type Announcement,
	normalizeBanners,
	popupMessage,
	statusText,
	statusTooltip,
} from "./banners";

import type { CoderApi } from "../api/coderApi";
import type { SecretsManager } from "../core/secretsManager";
import type { SessionState } from "../deployment/sessionStore";
import type { Logger } from "../logging/logger";

export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const VIEW_ACTION = "View";

interface RefreshOptions {
	readonly notify?: boolean;
	readonly showErrors?: boolean;
}

export class AnnouncementManager implements vscode.Disposable {
	private readonly statusBarItem = createStatusBarItem("announcements");
	private readonly sessionChangeDisposable: vscode.Disposable;
	#banners: readonly Announcement[] = [];
	private fetchGeneration = 0;
	private refreshTimeout: NodeJS.Timeout | undefined;
	private disposed = false;

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

	public async showAnnouncements(): Promise<void> {
		const refreshed = await this.refresh({ notify: false, showErrors: true });
		if (this.banners.length > 0) {
			await this.pickAnnouncement();
		} else if (refreshed) {
			// On failure the error popup is the whole story.
			void vscode.window.showInformationMessage(
				"No active Coder announcements.",
			);
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.cancelRefresh();
		this.sessionChangeDisposable.dispose();
		this.banners = [];
		this.statusBarItem.dispose();
	}

	private onSessionChange(): void {
		this.cancelRefresh();
		this.banners = [];
		if (this.sessionState.current.kind === "signedIn") {
			void this.refresh({ notify: true });
		}
	}

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

		const seen = new Set(
			this.secretsManager.getSeenBanners(session.deployment.safeHostname),
		);
		const unseen = banners.filter((banner) => !seen.has(banner.key));
		if (unseen.length === 0) {
			return;
		}
		const notifiable = !areNotificationsDisabled(
			vscode.workspace.getConfiguration(),
		);
		if (options.notify && notifiable) {
			this.showPopup(unseen);
		}
		// Mark seen only what the user could see; suppressed banners notify later.
		if (!options.notify || notifiable) {
			await this.secretsManager.setSeenBanners(
				session.deployment.safeHostname,
				[...seen, ...unseen.map((banner) => banner.key)],
			);
		}
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
		this.statusBarItem.tooltip = statusTooltip(banners);
		this.statusBarItem.show();
	}

	/** Non-modal messages may never settle, so chain instead of awaiting. */
	private showPopup(banners: readonly Announcement[]): void {
		Promise.resolve(
			vscode.window.showInformationMessage(popupMessage(banners), VIEW_ACTION),
		)
			.then((action) =>
				// Banners are seconds old; skip the refetch.
				action === VIEW_ACTION ? this.pickAnnouncement() : undefined,
			)
			.catch((error) => {
				this.logger.warn("Failed to show Coder announcement popup", error);
			});
	}

	private async pickAnnouncement(): Promise<void> {
		const selected = await vscode.window.showQuickPick(
			this.banners.map((banner, index) => ({
				label: `$(megaphone) Announcement ${index + 1}`,
				detail: banner.message,
				banner,
			})),
			{
				title: "Coder Announcements",
				placeHolder: "Select an announcement to view the full message",
			},
		);
		if (selected) {
			void vscode.window.showInformationMessage(selected.banner.message);
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
