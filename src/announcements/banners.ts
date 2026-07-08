import { createHash } from "node:crypto";

import type {
	AppearanceConfig,
	BannerConfig,
} from "coder/site/src/api/typesGenerated";

/** Popups are read at a glance; keep the single-banner message short. */
const POPUP_MESSAGE_MAX_LENGTH = 120;

export interface Announcement {
	readonly message: string;
	/** Fingerprint used to track which banners have been surfaced. */
	readonly key: string;
}

/**
 * Falls back to the deprecated service_banner only when announcement_banners
 * is absent, not merely empty. Duplicate messages collapse into one.
 */
export function normalizeBanners(
	appearance: AppearanceConfig,
): readonly Announcement[] {
	const banners = appearance.announcement_banners ?? [
		appearance.service_banner,
	];
	const announcements = banners
		.map((banner) => toAnnouncement(banner))
		.filter((banner): banner is Announcement => banner !== undefined);
	return [...new Map(announcements.map((a) => [a.key, a])).values()];
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

/** Truncates to a word boundary when possible; splits on code points so emoji survive. */
function truncate(message: string): string {
	const chars = [...message];
	if (chars.length <= POPUP_MESSAGE_MAX_LENGTH) {
		return message;
	}
	const cut = chars.slice(0, POPUP_MESSAGE_MAX_LENGTH - 1);
	const lastSpace = cut.lastIndexOf(" ");
	const trimmed =
		lastSpace > POPUP_MESSAGE_MAX_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;
	return `${trimmed.join("")}…`;
}
