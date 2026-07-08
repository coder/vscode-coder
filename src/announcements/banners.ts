import { createHash } from "node:crypto";

import type {
	AppearanceConfig,
	BannerConfig,
} from "coder/site/src/api/typesGenerated";

export interface Announcement {
	readonly message: string;
	/** Fingerprint used to track which banners have been surfaced. */
	readonly key: string;
	/** Admin-configured hex color (e.g. "#d32f2f"), if set and valid. */
	readonly backgroundColor?: string;
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

/** Status bar label: a megaphone plus the count when there's more than one. */
export function statusText(count: number): string {
	return `$(megaphone) Coder${count === 1 ? "" : ` ${count}`}`;
}

/** Hover is a quick glance; cap the list before pointing at the full preview. */
const HOVER_BANNER_LIMIT = 5;

/** Hard-breaks lines in one paragraph instead of a list: no indent, no implied order. */
export function hoverMarkdown(banners: readonly Announcement[]): string {
	const shown = banners.slice(0, HOVER_BANNER_LIMIT);
	const remaining = banners.length - shown.length;
	const list = shown.map((banner) => banner.message).join("  \n");
	return remaining > 0
		? `${list}\n\n+${remaining} more (click to view all)`
		: list;
}

/** Full markdown for the preview tab: each banner boxed in its own styled div. */
export function previewMarkdown(banners: readonly Announcement[]): string {
	const boxes = banners.map((banner) => announcementBox(banner));
	return [BOX_STYLE_RESET, ...boxes].join("\n\n");
}

/**
 * <p> only gets bottom margin, skewing the box's padding. Custom-colored
 * boxes also need links to inherit the text color instead of theme-blue.
 */
const BOX_STYLE_RESET =
	"<style>.coder-announcement p { margin: 0; } " +
	".coder-announcement-custom-color a { color: inherit; text-decoration: underline; }</style>";

/** Reuses the blockquote theme colors so the box still reads as native VS Code. */
const BOX_STYLE =
	"padding: 10px 14px; margin-bottom: 8px; border-radius: 4px; " +
	"background: var(--vscode-textBlockQuote-background); " +
	"border-left: 4px solid var(--vscode-textBlockQuote-border);";

/** A blank line around the content keeps it as real markdown, not opaque HTML. */
function announcementBox(banner: Announcement): string {
	// Admin colors stay fixed across themes, like coder/coder's dashboard.
	const className = banner.backgroundColor
		? "coder-announcement coder-announcement-custom-color"
		: "coder-announcement";
	const colorOverride = banner.backgroundColor
		? `background: ${banner.backgroundColor}; border-left-color: ${banner.backgroundColor}; color: ${readableForegroundColor(banner.backgroundColor)};`
		: "";
	return [
		`<div class="${className}" style="${BOX_STYLE} ${colorOverride}">`,
		"",
		banner.message,
		"",
		"</div>",
	].join("\n");
}

/** Mirrors coder/coder's dashboard heuristic so banner colors read the same way. */
function readableForegroundColor(hexColor: string): string {
	const r = parseInt(hexColor.slice(1, 3), 16);
	const g = parseInt(hexColor.slice(3, 5), 16);
	const b = parseInt(hexColor.slice(5, 7), 16);
	const yiq = (r * 299 + g * 587 + b * 114) / 1000;
	return yiq >= 128 ? "#000" : "#fff";
}

/** Plain text, no markdown, so it's always a generic count, never banner content. */
export function popupMessage(banners: readonly Announcement[]): string {
	return banners.length === 1
		? "Coder has a new deployment announcement."
		: `Coder has ${banners.length} new deployment announcements.`;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function toAnnouncement(
	banner: BannerConfig | undefined,
): Announcement | undefined {
	const message = banner?.message?.trim();
	if (!banner?.enabled || !message) {
		return undefined;
	}
	const backgroundColor =
		banner.background_color && HEX_COLOR.test(banner.background_color)
			? banner.background_color
			: undefined;
	return { message, key: bannerKey(message), backgroundColor };
}

function bannerKey(message: string): string {
	return createHash("sha256").update(message).digest("hex").slice(0, 16);
}
