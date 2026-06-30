import { describe, expect, it } from "vitest";

import {
	bannerKey,
	normalizeBanners,
	popupMessage,
	sourceIcon,
	sourceLabel,
	statusText,
	statusTooltip,
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
	it("returns active service and announcement banners", () => {
		const banners = normalizeBanners(
			appearance({
				service_banner: banner({
					message: " Service banner ",
					background_color: " #123456 ",
				}),
				announcement_banners: [
					banner({ message: " Announcement " }),
					banner({ enabled: false, message: "Disabled" }),
					banner({ message: "   " }),
				],
			}),
		);

		expect(banners).toMatchObject([
			{
				source: "service",
				message: "Service banner",
				backgroundColor: "#123456",
			},
			{
				source: "announcement",
				message: "Announcement",
				backgroundColor: "#004852",
			},
		]);
		expect(banners).toHaveLength(2);
		expect(banners[0].key).toBe(
			bannerKey({
				source: "service",
				message: "Service banner",
				backgroundColor: "#123456",
			}),
		);
	});

	it("keeps keys stable when banners reorder", () => {
		const original = announcements("First", "Second");
		const reordered = announcements("Second", "First");
		const keyFor = (message: string, banners = original) =>
			banners.find((banner) => banner.message === message)?.key;

		expect(keyFor("First", reordered)).toBe(keyFor("First"));
		expect(keyFor("Second", reordered)).toBe(keyFor("Second"));
	});

	it("changes keys when fingerprint fields change", () => {
		const key = bannerKey({
			source: "announcement",
			message: "Maintenance tonight",
			backgroundColor: "#004852",
		});

		expect(
			bannerKey({
				source: "service",
				message: "Maintenance tonight",
				backgroundColor: "#004852",
			}),
		).not.toBe(key);
		expect(
			bannerKey({
				source: "announcement",
				message: "Maintenance tomorrow",
				backgroundColor: "#004852",
			}),
		).not.toBe(key);
		expect(
			bannerKey({
				source: "announcement",
				message: "Maintenance tonight",
				backgroundColor: "#111111",
			}),
		).not.toBe(key);
	});
});

describe("banner copy", () => {
	it("formats status bar text and tooltip", () => {
		const banners = announcements("First", "Second");

		expect(statusText(1)).toBe("$(megaphone) Coder");
		expect(statusText(2)).toBe("$(megaphone) Coder 2");
		expect(statusTooltip(banners)).toBe(
			"Coder deployment announcements\n\n1. First\n2. Second",
		);
	});

	it("formats popup messages", () => {
		const longMessage = "a".repeat(121);

		expect(popupMessage(announcements("Maintenance tonight"))).toBe(
			"Coder announcement: Maintenance tonight",
		);
		expect(popupMessage(announcements("First", "Second"))).toBe(
			"Coder has 2 new deployment announcements.",
		);
		expect(popupMessage(announcements(longMessage))).toBe(
			`Coder announcement: ${"a".repeat(119)}…`,
		);
	});

	it("formats QuickPick source labels", () => {
		expect(sourceIcon("service")).toBe("$(info)");
		expect(sourceIcon("announcement")).toBe("$(megaphone)");
		expect(sourceLabel("service")).toBe("Service banner");
		expect(sourceLabel("announcement")).toBe("Announcement");
	});
});
