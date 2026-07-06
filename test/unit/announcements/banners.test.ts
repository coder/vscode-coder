import { describe, expect, it } from "vitest";

import {
	normalizeBanners,
	popupMessage,
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
		expect(popupMessage(announcements("Maintenance tonight"))).toBe(
			"Coder announcement: Maintenance tonight",
		);
		expect(popupMessage(announcements("First", "Second"))).toBe(
			"Coder has 2 new deployment announcements.",
		);
	});

	it("truncates long popup messages without splitting emoji", () => {
		expect(popupMessage(announcements("a".repeat(121)))).toBe(
			`Coder announcement: ${"a".repeat(119)}…`,
		);
		expect(
			popupMessage(announcements(`${"a".repeat(118)}🚀${"b".repeat(10)}`)),
		).toBe(`Coder announcement: ${"a".repeat(118)}🚀…`);
	});
});
