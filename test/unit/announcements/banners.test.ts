import { describe, expect, it } from "vitest";

import {
	hoverMarkdown,
	normalizeBanners,
	popupMessage,
	previewMarkdown,
	statusText,
} from "@/announcements/banners";

import type {
	AppearanceConfig,
	BannerConfig,
} from "coder/site/src/api/typesGenerated";

function banner(overrides: Partial<BannerConfig> = {}): BannerConfig {
	return {
		enabled: true,
		message: "Maintenance tonight",
		background_color: "#004852",
		...overrides,
	};
}

function appearance(
	overrides: Partial<AppearanceConfig> = {},
): AppearanceConfig {
	return {
		application_name: "Coder",
		logo_url: "",
		docs_url: "",
		service_banner: { enabled: false },
		announcement_banners: [],
		...overrides,
	};
}

function announcements(...messages: string[]) {
	return normalizeBanners(
		appearance({
			announcement_banners: messages.map((message) => banner({ message })),
		}),
	);
}

describe("normalizeBanners", () => {
	it("returns active announcement banners trimmed", () => {
		const banners = normalizeBanners(
			appearance({
				announcement_banners: [
					banner({ message: " First " }),
					banner({ enabled: false, message: "Disabled" }),
					banner({ message: "   " }),
					banner({ message: "Second" }),
				],
			}),
		);

		expect(banners.map((banner) => banner.message)).toEqual([
			"First",
			"Second",
		]);
	});

	it("ignores the service banner that modern deployments mirror from the first announcement", () => {
		const banners = normalizeBanners(
			appearance({
				service_banner: banner(),
				announcement_banners: [banner(), banner({ message: "Second" })],
			}),
		);

		expect(banners.map((banner) => banner.message)).toEqual([
			"Maintenance tonight",
			"Second",
		]);
	});

	it("falls back to the service banner on older deployments", () => {
		expect(normalizeBanners({} as AppearanceConfig)).toEqual([]);
		expect(
			normalizeBanners({ service_banner: banner() } as AppearanceConfig),
		).toMatchObject([{ message: "Maintenance tonight" }]);
	});

	it("keys follow the message and survive reordering", () => {
		const [first, second] = announcements("First", "Second");
		const [reorderedSecond, reorderedFirst] = announcements("Second", "First");

		expect(reorderedFirst.key).toBe(first.key);
		expect(reorderedSecond.key).toBe(second.key);
		expect(first.key).not.toBe(second.key);
	});

	it("collapses banners with identical content", () => {
		const banners = announcements("Same message", "Same message");

		expect(banners).toHaveLength(1);
	});

	it("shows nothing when a modern deployment reports no announcements", () => {
		const banners = normalizeBanners(
			appearance({
				service_banner: banner(),
				announcement_banners: [],
			}),
		);

		expect(banners).toEqual([]);
	});
});

describe("banner copy", () => {
	it("formats status bar text and the hover markdown", () => {
		const banners = announcements("First", "Second");

		expect(statusText(1)).toBe("$(megaphone) Coder");
		expect(statusText(2)).toBe("$(megaphone) Coder 2");
		expect(hoverMarkdown(banners)).toBe("First  \nSecond");
	});

	it("caps the hover list and points at the full preview", () => {
		const banners = announcements("A", "B", "C", "D", "E", "F", "G");

		expect(hoverMarkdown(banners)).toBe(
			"A  \nB  \nC  \nD  \nE\n\n+2 more (click to view all)",
		);
	});

	it("boxes each announcement in its own styled div, blank-line separated so markdown still renders inside", () => {
		const banners = announcements("First");

		expect(previewMarkdown(banners)).toMatch(
			/^<style>.*<\/style>\n\n<div class="coder-announcement coder-announcement-custom-color" style="[^"]+">\n\nFirst\n\n<\/div>$/,
		);
	});

	it("makes links inherit the custom color box's text color instead of the theme's link color", () => {
		const banners = announcements("First");

		expect(previewMarkdown(banners)).toContain(
			".coder-announcement-custom-color a { color: inherit; text-decoration: underline; }",
		);
	});

	it("joins multiple boxes with a blank line between them", () => {
		const banners = announcements("First", "Second");
		const markdown = previewMarkdown(banners);

		expect(markdown).toContain("First");
		expect(markdown).toContain("Second");
		expect(markdown.match(/<div /g)).toHaveLength(2);
	});

	it("keeps a multi-line message inside the same box", () => {
		const banners = normalizeBanners(
			appearance({
				announcement_banners: [banner({ message: "Line one\nLine two" })],
			}),
		);

		expect(previewMarkdown(banners)).toContain("Line one\nLine two");
	});

	it("uses the banner's own background color with readable contrast text", () => {
		const banners = normalizeBanners(
			appearance({
				announcement_banners: [
					banner({ message: "Dark", background_color: "#000000" }),
					banner({ message: "Light", background_color: "#ffffff" }),
				],
			}),
		);
		const markdown = previewMarkdown(banners);

		expect(markdown).toContain(
			"background: #000000; border-left-color: #000000; color: #fff;",
		);
		expect(markdown).toContain(
			"background: #ffffff; border-left-color: #ffffff; color: #000;",
		);
	});

	it("falls back to the default theme color when background_color is missing or invalid", () => {
		const banners = normalizeBanners(
			appearance({
				announcement_banners: [
					banner({ message: "No color", background_color: undefined }),
					banner({ message: "Bad color", background_color: "not-a-color" }),
				],
			}),
		);
		const markdown = previewMarkdown(banners);

		expect(markdown).not.toContain("border-left-color");
		expect(markdown).not.toContain(
			'class="coder-announcement coder-announcement-custom-color"',
		);
		expect(markdown).toContain("var(--vscode-textBlockQuote-background)");
	});

	it("formats popup messages as a generic count, never banner content", () => {
		expect(popupMessage(announcements("Maintenance tonight"))).toBe(
			"Coder has a new deployment announcement.",
		);
		expect(popupMessage(announcements("First", "Second"))).toBe(
			"Coder has 2 new deployment announcements.",
		);
	});
});
