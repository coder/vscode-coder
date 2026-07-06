import { createHash } from "node:crypto";

import type {
	AppearanceConfig,
	BannerConfig,
} from "coder/site/src/api/typesGenerated";

const POPUP_MESSAGE_MAX_LENGTH = 120;

export interface Announcement {
	readonly message: string;
	/** Stable fingerprint used to track which banners were already seen. */
	readonly key: string;
}

export function normalizeBanners(
	appearance: AppearanceConfig,
): readonly Announcement[] {
	// Modern servers mirror announcements[0] into the deprecated service_banner.
	const banners = appearance.announcement_banners ?? [
		appearance.service_banner,
	];
	return banners
		.map((banner) => toAnnouncement(banner))
		.filter((banner): banner is Announcement => banner !== undefined);
}

export function statusText(count: number): string {
	return `$(megaphone) Coder${count === 1 ? "" : ` ${count}`}`;
}

export function statusTooltip(banners: readonly Announcement[]): string {
	return [
		`Coder deployment announcement${banners.length === 1 ? "" : "s"}`,
		"",
		...banners.map((banner, index) => `${index + 1}. ${banner.message}`),
	].join("\n");
}

export function popupMessage(banners: readonly Announcement[]): string {
	return banners.length === 1
		? `Coder announcement: ${truncate(banners[0].message)}`
		: `Coder has ${banners.length} new deployment announcements.`;
}

function toAnnouncement(
	banner: BannerConfig | undefined,
): Announcement | undefined {
	const message = banner?.message?.trim();
	if (!banner?.enabled || !message) {
		return undefined;
	}
	return { message, key: bannerKey(message) };
}

function bannerKey(message: string): string {
	return createHash("sha256").update(message).digest("hex").slice(0, 16);
}

function truncate(message: string): string {
	// Slice code points so emoji are never cut in half.
	const chars = [...message];
	return chars.length <= POPUP_MESSAGE_MAX_LENGTH
		? message
		: `${chars.slice(0, POPUP_MESSAGE_MAX_LENGTH - 1).join("")}…`;
}
