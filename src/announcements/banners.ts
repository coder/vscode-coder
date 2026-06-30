import { createHash } from "node:crypto";

import type {
	AppearanceConfig,
	BannerConfig,
} from "coder/site/src/api/typesGenerated";

const POPUP_MESSAGE_MAX_LENGTH = 120;

export type AnnouncementSource = "announcement" | "service";

export interface Announcement {
	readonly source: AnnouncementSource;
	readonly message: string;
	readonly backgroundColor?: string;
	readonly key: string;
}

export function normalizeBanners(
	appearance: AppearanceConfig,
): readonly Announcement[] {
	return [
		toAnnouncement("service", appearance.service_banner),
		...appearance.announcement_banners.map((banner) =>
			toAnnouncement("announcement", banner),
		),
	].filter((banner): banner is Announcement => banner !== undefined);
}

export function bannerKey(
	banner: Pick<Announcement, "source" | "message" | "backgroundColor">,
): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				source: banner.source,
				message: banner.message,
				backgroundColor: banner.backgroundColor ?? "",
			}),
		)
		.digest("hex")
		.slice(0, 16);
}

export function statusText(count: number): string {
	return count === 1 ? "$(megaphone) Coder" : `$(megaphone) Coder ${count}`;
}

export function statusTooltip(banners: readonly Announcement[]): string {
	return [
		banners.length === 1
			? "Coder deployment announcement"
			: "Coder deployment announcements",
		"",
		...banners.map((banner, index) => `${index + 1}. ${banner.message}`),
	].join("\n");
}

export function popupMessage(banners: readonly Announcement[]): string {
	return banners.length === 1
		? `Coder announcement: ${truncate(banners[0].message)}`
		: `Coder has ${banners.length} new deployment announcements.`;
}

export function sourceLabel(source: AnnouncementSource): string {
	return source === "service" ? "Service banner" : "Announcement";
}

export function sourceIcon(source: AnnouncementSource): string {
	return source === "service" ? "$(info)" : "$(megaphone)";
}

function toAnnouncement(
	source: AnnouncementSource,
	banner: BannerConfig,
): Announcement | undefined {
	const message = banner.message?.trim();
	const backgroundColor = banner.background_color?.trim() || undefined;
	if (!banner.enabled || !message) {
		return undefined;
	}
	return {
		source,
		message,
		backgroundColor,
		key: bannerKey({ source, message, backgroundColor }),
	};
}

function truncate(message: string): string {
	return message.length <= POPUP_MESSAGE_MAX_LENGTH
		? message
		: `${message.slice(0, POPUP_MESSAGE_MAX_LENGTH - 1)}…`;
}
