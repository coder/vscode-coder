import { describe, it, expect, vi } from "vitest";
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
			changes.push([...changed.keys()]),
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

		expect(changes).toEqual([["test.setting"]]);
		dispose();
	});

	describe("debounced (idle window)", () => {
		const setup = () => {
			vi.useFakeTimers();
			const config = new MockConfigurationProvider();
			config.set("test.setting", "initial");
			const changes: Array<ReadonlyMap<string, unknown>> = [];
			const watcher = watchConfigurationChanges(
				[
					{
						setting: "test.setting",
						getValue: () =>
							vscode.workspace.getConfiguration().get("test.setting"),
					},
				],
				(c) => changes.push(c),
				{ debounceMs: 250 },
			);
			return { config, changes, watcher };
		};

		it("coalesces changes within the window and emits the final value", () => {
			const { config, changes, watcher } = setup();
			try {
				config.set("test.setting", "changed1");
				config.set("test.setting", "changed2");
				vi.advanceTimersByTime(249);
				expect(changes).toEqual([]);
				vi.advanceTimersByTime(1);
				expect(changes.map((c) => c.get("test.setting"))).toEqual(["changed2"]);
			} finally {
				watcher.dispose();
				vi.useRealTimers();
			}
		});

		it("suppresses emission when the final value matches the applied value", () => {
			const { config, changes, watcher } = setup();
			try {
				config.set("test.setting", "");
				config.set("test.setting", "initial");
				vi.advanceTimersByTime(250);
				expect(changes).toEqual([]);
			} finally {
				watcher.dispose();
				vi.useRealTimers();
			}
		});

		it("resets the idle window on each event and fires once after the burst settles", () => {
			const { config, changes, watcher } = setup();
			try {
				// Events spaced inside the window keep resetting the timer.
				for (let i = 0; i < 5; i++) {
					config.set("test.setting", `tick-${i}`);
					vi.advanceTimersByTime(200);
				}
				expect(changes).toEqual([]);

				// Once quiet, the callback fires exactly once with the last value.
				vi.advanceTimersByTime(250);
				expect(changes.map((c) => c.get("test.setting"))).toEqual(["tick-4"]);
			} finally {
				watcher.dispose();
				vi.useRealTimers();
			}
		});
	});
});
