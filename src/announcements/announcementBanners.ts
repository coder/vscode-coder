import { createHash } from "node:crypto";
import * as vscode from "vscode";

import { type CoderApi } from "../api/coderApi";
import { type SecretsManager } from "../core/secretsManager";
import {
	type SessionData,
	type SessionState,
} from "../deployment/sessionStore";
import { type Logger } from "../logging/logger";
import { areNotificationsDisabled } from "../settings/notifications";

import type {
	AppearanceConfig,
	BannerConfig,
} from "coder/site/src/api/typesGenerated";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const VIEW_ACTION = "View";
const POPUP_MESSAGE_MAX_LENGTH = 120;

export type AnnouncementBannerSource = "announcement" | "service";

export interface ActiveAnnouncementBanner {
	readonly source: AnnouncementBannerSource;
	readonly message: string;
	readonly backgroundColor?: string;
	readonly key: string;
}

interface RefreshOptions {
	readonly notify: boolean;
	readonly showErrors?: boolean;
}

interface BannerFingerprintInput {
	readonly source: AnnouncementBannerSource;
	readonly message: string;
	readonly backgroundColor?: string;
}

export class AnnouncementBannerManager implements vscode.Disposable {
	private readonly statusBarItem: vscode.StatusBarItem;
	private readonly sessionChangeDisposable: vscode.Disposable;
	private activeBanners: readonly ActiveAnnouncementBanner[] = [];
	private refreshTimeout: NodeJS.Timeout | undefined;
	private disposed = false;

	public constructor(
		private readonly client: CoderApi,
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
			this.handleSessionChange();
		});
		this.handleSessionChange();
	}

	public dispose(): void {
		this.disposed = true;
		this.cancelRefresh();
		this.sessionChangeDisposable.dispose();
		this.statusBarItem.dispose();
	}

	public refresh(
		options: RefreshOptions = { notify: true },
	): Promise<readonly ActiveAnnouncementBanner[] | undefined> {
		if (this.disposed) {
			return Promise.resolve(undefined);
		}

		this.cancelRefresh();
		return this.runRefresh(options)
			.catch((error: unknown) => {
				this.logger.warn("Failed to refresh Coder announcements", error);
				if (options.showErrors) {
					void vscode.window.showErrorMessage(
						`Failed to refresh Coder announcements: ${formatError(error)}`,
					);
				}
				return undefined;
			})
			.finally(() => {
				this.scheduleRefresh();
			});
	}

	public async showAnnouncements(): Promise<void> {
		const banners =
			(await this.refresh({ notify: false, showErrors: true })) ??
			this.activeBanners;

		if (banners.length === 0) {
			void vscode.window.showInformationMessage(
				"No active Coder announcements.",
			);
			return;
		}

		const selected = await vscode.window.showQuickPick(
			banners.map((banner, index) => ({
				label: `${sourceIcon(banner.source)} ${sourceLabel(banner.source)} ${index + 1}`,
				detail: banner.message,
				description: banner.backgroundColor,
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

	private handleSessionChange(): void {
		this.cancelRefresh();
		if (this.sessionState.current.kind !== "signedIn") {
			this.setActiveBanners([]);
			return;
		}

		this.setActiveBanners([]);
		void this.refresh({ notify: true });
	}

	private async runRefresh(
		options: RefreshOptions,
	): Promise<readonly ActiveAnnouncementBanner[] | undefined> {
		const session = this.sessionState.current;
		if (session.kind !== "signedIn") {
			this.setActiveBanners([]);
			return [];
		}

		const appearance = await this.client.getAppearance();
		if (this.sessionChangedSince(session)) {
			return undefined;
		}

		const banners = normalizeAnnouncementBanners(appearance);
		this.setActiveBanners(banners);

		const seen = new Set(
			this.secretsManager.getSeenBanners(session.deployment.safeHostname),
		);
		const newBanners = banners.filter((banner) => !seen.has(banner.key));

		const cfg = vscode.workspace.getConfiguration();
		if (
			options.notify &&
			newBanners.length > 0 &&
			!areNotificationsDisabled(cfg)
		) {
			this.showPopup(newBanners);
		}

		await this.secretsManager.setSeenBanners(
			session.deployment.safeHostname,
			banners.map((banner) => banner.key),
		);

		return banners;
	}

	private sessionChangedSince(session: SessionData): boolean {
		return this.disposed || this.sessionState.current !== session;
	}

	private setActiveBanners(banners: readonly ActiveAnnouncementBanner[]): void {
		this.activeBanners = banners;
		if (banners.length === 0) {
			this.statusBarItem.hide();
			return;
		}

		this.statusBarItem.text = formatStatusBarText(banners.length);
		this.statusBarItem.tooltip = formatStatusBarTooltip(banners);
		this.statusBarItem.show();
	}

	private showPopup(banners: readonly ActiveAnnouncementBanner[]): void {
		const message = formatPopupMessage(banners);
		void Promise.resolve(
			vscode.window.showInformationMessage(message, VIEW_ACTION),
		)
			.then((action) => {
				if (action === VIEW_ACTION) {
					void this.showAnnouncements();
				}
			})
			.catch((error: unknown) => {
				this.logger.warn("Failed to show Coder announcement popup", error);
			});
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

export function normalizeAnnouncementBanners(
	appearance: AppearanceConfig,
): readonly ActiveAnnouncementBanner[] {
	const banners: ActiveAnnouncementBanner[] = [];
	const serviceBanner = toActiveBanner("service", appearance.service_banner);
	if (serviceBanner) {
		banners.push(serviceBanner);
	}

	for (const banner of appearance.announcement_banners) {
		const activeBanner = toActiveBanner("announcement", banner);
		if (activeBanner) {
			banners.push(activeBanner);
		}
	}

	return banners;
}

function toActiveBanner(
	source: AnnouncementBannerSource,
	banner: BannerConfig,
): ActiveAnnouncementBanner | undefined {
	const message = banner.message?.trim();
	if (!banner.enabled || !message) {
		return undefined;
	}
	const backgroundColor = banner.background_color?.trim();
	return {
		source,
		message,
		backgroundColor: backgroundColor || undefined,
		key: getBannerKey({ source, message, backgroundColor }),
	};
}

export function getBannerKey(input: BannerFingerprintInput): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				source: input.source,
				message: input.message,
				backgroundColor: input.backgroundColor ?? "",
			}),
		)
		.digest("hex")
		.slice(0, 16);
}

function formatStatusBarText(count: number): string {
	return count === 1 ? "$(megaphone) Coder" : `$(megaphone) Coder ${count}`;
}

function formatStatusBarTooltip(
	banners: readonly ActiveAnnouncementBanner[],
): string {
	const heading =
		banners.length === 1
			? "Coder deployment announcement"
			: "Coder deployment announcements";
	return [
		heading,
		"",
		...banners.map((banner, index) => `${index + 1}. ${banner.message}`),
	].join("\n");
}

function formatPopupMessage(
	banners: readonly ActiveAnnouncementBanner[],
): string {
	if (banners.length === 1) {
		return `Coder announcement: ${truncateMessage(banners[0].message)}`;
	}
	return `Coder has ${banners.length} new deployment announcements.`;
}

function truncateMessage(message: string): string {
	if (message.length <= POPUP_MESSAGE_MAX_LENGTH) {
		return message;
	}
	return `${message.slice(0, POPUP_MESSAGE_MAX_LENGTH - 1)}…`;
}

function sourceIcon(source: AnnouncementBannerSource): string {
	return source === "service" ? "$(info)" : "$(megaphone)";
}

function sourceLabel(source: AnnouncementBannerSource): string {
	return source === "service" ? "Service banner" : "Announcement";
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
