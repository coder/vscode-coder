import { describe, it, expect } from "vitest";
import * as vscode from "vscode";

import {
	watchConfigurationChanges,
	type WatchedSetting,
} from "@/configWatcher";

import { MockConfigurationProvider } from "../mocks/testHelpers";

describe("watchConfigurationChanges", () => {
	const createWatcher = (...keys: string[]) => {
		const changes: string[][] = [];
		const settings: WatchedSetting[] = keys.map((key) => ({
			setting: key,
			getValue: () => vscode.workspace.getConfiguration().get(key),
		}));
		const watcher = watchConfigurationChanges(settings, (changed) =>
			changes.push(changed),
		);
		return { changes, dispose: () => watcher.dispose() };
	};

	it("fires callback when watched setting value changes", () => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", "initial");
		const { changes, dispose } = createWatcher("test.setting");

		config.set("test.setting", "changed");

		expect(changes).toEqual([["test.setting"]]);
		dispose();
	});

	it("does not fire callback when value is unchanged", () => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", "value");
		const { changes, dispose } = createWatcher("test.setting");

		config.set("test.setting", "value");

		expect(changes).toEqual([]);
		dispose();
	});

	it("does not fire callback for unrelated settings", () => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", "initial");
		const { changes, dispose } = createWatcher("test.setting");

		config.set("other.setting", "some-value");

		expect(changes).toEqual([]);
		dispose();
	});

	it("tracks value changes across multiple events", () => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", "initial");
		const { changes, dispose } = createWatcher("test.setting");

		config.set("test.setting", "changed1");
		config.set("test.setting", "changed2");
		config.set("test.setting", "changed2"); // same value - no callback
		config.set("test.setting", "changed1"); // back to changed1 - should fire

		expect(changes).toEqual([
			["test.setting"],
			["test.setting"],
			["test.setting"],
		]);
		dispose();
	});

	it("stops watching after dispose", () => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", "initial");
		const { changes, dispose } = createWatcher("test.setting");
		dispose();

		config.set("test.setting", "changed");

		expect(changes).toEqual([]);
	});

	it("uses deep equality for object values", () => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", { key: "value" });
		const { changes, dispose } = createWatcher("test.setting");

		config.set("test.setting", { key: "value" }); // deep equal - no callback
		config.set("test.setting", { key: "different" });

		expect(changes).toEqual([["test.setting"]]);
		dispose();
	});
});
