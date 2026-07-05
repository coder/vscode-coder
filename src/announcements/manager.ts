import * as vscode from "vscode";

import { errToStr } from "../api/api-helper";
import { type CoderApi } from "../api/coderApi";
import { type SecretsManager } from "../core/secretsManager";
import { type SessionState } from "../deployment/sessionStore";
import { type Logger } from "../logging/logger";
import { areNotificationsDisabled } from "../settings/notifications";

import {
	type Announcement,
	normalizeBanners,
	popupMessage,
	statusText,
	statusTooltip,
} from "./banners";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const VIEW_ACTION = "View";

interface RefreshOptions {
	readonly notify?: boolean;
	readonly showErrors?: boolean;
}

export class AnnouncementManager implements vscode.Disposable {
	private readonly statusBarItem: vscode.StatusBarItem;
	private readonly sessionChangeDisposable: vscode.Disposable;
	private banners: readonly Announcement[] = [];
	private refreshTimeout: NodeJS.Timeout | undefined;
	private disposed = false;

	public constructor(
		private readonly client: Pick<CoderApi, "getAppearance">,
		private readonly sessionState: SessionState,
		private readonly secretsManager: SecretsManager,
		private readonly logger: Logger,
	) {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			998,
		);
		this.statusBarItem.name = "Coder Announcements";
		this.statusBarItem.command = "coder.viewAnnouncements";
		this.sessionChangeDisposable = this.sessionState.onDidChange(() => {
			this.onSessionChange();
		});
		this.onSessionChange();
	}

	public dispose(): void {
		this.disposed = true;
		this.cancelRefresh();
		this.sessionChangeDisposable.dispose();
		this.statusBarItem.dispose();
	}

	public async refresh(
		options: RefreshOptions = {},
	): Promise<readonly Announcement[] | undefined> {
		if (this.disposed) {
			return undefined;
		}
		this.cancelRefresh();
		try {
			return await this.fetch(options);
		} catch (error) {
			this.logger.warn("Failed to refresh Coder announcements", error);
			if (options.showErrors) {
				void vscode.window.showErrorMessage(
					`Failed to refresh Coder announcements: ${errToStr(error)}`,
				);
			}
			return undefined;
		} finally {
			this.scheduleRefresh();
		}
	}

	public async showAnnouncements(): Promise<void> {
		const banners =
			(await this.refresh({ notify: false, showErrors: true })) ?? this.banners;
		if (banners.length === 0) {
			void vscode.window.showInformationMessage(
				"No active Coder announcements.",
			);
			return;
		}

		const selected = await vscode.window.showQuickPick(
			banners.map((banner, index) => ({
				label: `${banner.source === "service" ? "$(info) Service banner" : "$(megaphone) Announcement"} ${index + 1}`,
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

	private onSessionChange(): void {
		this.cancelRefresh();
		this.setBanners([]);
		if (this.sessionState.current.kind === "signedIn") {
			void this.refresh({ notify: true });
		}
	}

	private async fetch(
		options: RefreshOptions,
	): Promise<readonly Announcement[] | undefined> {
		const session = this.sessionState.current;
		if (session.kind !== "signedIn") {
			this.setBanners([]);
			return [];
		}

		const banners = normalizeBanners(await this.client.getAppearance());
		if (this.disposed || this.sessionState.current !== session) {
			return undefined;
		}
		this.setBanners(banners);

		const seen = new Set(
			this.secretsManager.getSeenBanners(session.deployment.safeHostname),
		);
		const keys = banners.map((banner) => banner.key);
		const unseen = banners.filter((banner) => !seen.has(banner.key));
		if (
			options.notify &&
			unseen.length > 0 &&
			!areNotificationsDisabled(vscode.workspace.getConfiguration())
		) {
			void this.showPopup(unseen);
		}
		if (unseen.length > 0 || seen.size !== new Set(keys).size) {
			await this.secretsManager.setSeenBanners(
				session.deployment.safeHostname,
				keys,
			);
		}
		return banners;
	}

	private setBanners(banners: readonly Announcement[]): void {
		this.banners = banners;
		if (banners.length === 0) {
			this.statusBarItem.hide();
			return;
		}
		this.statusBarItem.text = statusText(banners.length);
		this.statusBarItem.tooltip = statusTooltip(banners);
		this.statusBarItem.show();
	}

	private async showPopup(banners: readonly Announcement[]): Promise<void> {
		try {
			const action = await vscode.window.showInformationMessage(
				popupMessage(banners),
				VIEW_ACTION,
			);
			if (action === VIEW_ACTION) {
				void this.showAnnouncements();
			}
		} catch (error) {
			this.logger.warn("Failed to show Coder announcement popup", error);
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
