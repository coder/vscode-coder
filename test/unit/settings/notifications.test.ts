import { beforeEach, describe, expect, it } from "vitest";

import {
	areNotificationsDisabled,
	areUpdateNotificationsDisabled,
} from "@/settings/notifications";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

describe("notification settings", () => {
	let config: MockConfigurationProvider;

	beforeEach(() => {
		config = new MockConfigurationProvider();
	});

	describe("areNotificationsDisabled", () => {
		it.each([
			[undefined, false],
			[false, false],
			[true, true],
		])(
			"when coder.disableNotifications is %s, returns %s",
			(value, expected) => {
				if (value !== undefined) {
					config.set("coder.disableNotifications", value);
				}
				expect(areNotificationsDisabled(config)).toBe(expected);
			},
		);
	});

	describe("areUpdateNotificationsDisabled", () => {
		it.each([
			[false, false, false],
			[true, false, true],
			[false, true, true],
			[true, true, true],
		])(
			"when disableNotifications=%s and disableUpdateNotifications=%s, returns %s",
			(disableAll, disableUpdate, expected) => {
				config.set("coder.disableNotifications", disableAll);
				config.set("coder.disableUpdateNotifications", disableUpdate);
				expect(areUpdateNotificationsDisabled(config)).toBe(expected);
			},
		);
	});
});
