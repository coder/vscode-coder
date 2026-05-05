import { describe, it, expect } from "vitest";
import * as vscode from "vscode";

import {
	watchConfigurationChanges,
	type WatchedSetting,
} from "@/configWatcher";

import { MockConfigurationProvider } from "../mocks/testHelpers";

describe("watchConfigurationChanges", () => {
	const createWatcher = (...keys: string[]) => {
		const changes: Array<ReadonlyMap<string, unknown>> = [];
		const settings: WatchedSetting[] = keys.map((key) => ({
			setting: key,
			getValue: () => vscode.workspace.getConfiguration().get(key),
		}));
		const watcher = watchConfigurationChanges(settings, (c) => changes.push(c));
		return { changes, dispose: () => watcher.dispose() };
	};

	it("fires callback with the new value when a watched setting changes", () => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", "initial");
		const { changes, dispose } = createWatcher("test.setting");

		config.set("test.setting", "changed");

		expect(changes).toHaveLength(1);
		expect(changes[0].get("test.setting")).toBe("changed");
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

		expect(changes.map((c) => c.get("test.setting"))).toEqual([
			"changed1",
			"changed2",
			"changed1",
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

		expect(changes).toHaveLength(1);
		expect(changes[0].get("test.setting")).toEqual({ key: "different" });
		dispose();
	});

	it("treats undefined, null, empty string, and empty array as equivalent", () => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", undefined);
		const { changes, dispose } = createWatcher("test.setting");

		config.set("test.setting", null);
		config.set("test.setting", "");
		config.set("test.setting", []);
		config.set("test.setting", undefined);

		expect(changes).toEqual([]);
		dispose();
	});

	interface ValueChangeTestCase {
		name: string;
		from: unknown;
		to: unknown;
	}

	it.each<ValueChangeTestCase>([
		{ name: "undefined to value", from: undefined, to: "value" },
		{ name: "value to empty string", from: "value", to: "" },
		{ name: "undefined to false", from: undefined, to: false },
		{ name: "undefined to zero", from: undefined, to: 0 },
		{ name: "null to value", from: null, to: "value" },
		{ name: "empty string to value", from: "", to: "value" },
		{ name: "empty array to non-empty array", from: [], to: ["item"] },
		{ name: "value to different value", from: "old", to: "new" },
	])("detects change: $name", ({ from, to }) => {
		const config = new MockConfigurationProvider();
		config.set("test.setting", from);
		const { changes, dispose } = createWatcher("test.setting");

		config.set("test.setting", to);

		expect(changes).toHaveLength(1);
		expect(changes[0].has("test.setting")).toBe(true);
		dispose();
	});
});
