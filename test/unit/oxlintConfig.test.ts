import * as jsonc from "jsonc-parser";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CONFIG_PATH = path.join(REPO_ROOT, ".oxlintrc.jsonc");

interface Override {
	files: string[];
	jsPlugins?: Array<string | { name: string; specifier: string }>;
}

const { overrides = [] } = jsonc.parse(
	fs.readFileSync(CONFIG_PATH, "utf8"),
) as {
	overrides?: Override[];
};

const specifier = (plugin: string | { name: string; specifier: string }) =>
	typeof plugin === "string" ? plugin : plugin.specifier;

describe("oxlint config", () => {
	it("has no extglob alternatives in override patterns", () => {
		// oxlint's glob matcher silently drops patterns with `@(a|b)`
		// (oxc-project/oxc#21525); they never match anything.
		const offenders = overrides.flatMap((override, index) =>
			override.files
				.filter((pattern) => /@\([^)]*\|/.test(pattern))
				.map((pattern) => `overrides[${index}] ${pattern}`),
		);
		expect(offenders).toEqual([]);
	});

	it("applies the storybook override to story files", () => {
		// Storybook rules only fire where the override applies, and its generated
		// `**/*.stories.@(ts|tsx)` pattern silently matched nothing.
		const storybookIndexes = overrides.flatMap((override, index) =>
			(override.jsPlugins ?? []).some((p) =>
				specifier(p).includes("eslint-plugin-storybook"),
			)
				? [index]
				: [],
		);
		expect(storybookIndexes.length).toBeGreaterThan(0);

		const story = "packages/tasks/src/components/CreateTaskSection.stories.tsx";
		const output = execFileSync(
			process.execPath,
			[
				path.join(REPO_ROOT, "node_modules/oxlint/bin/oxlint"),
				"--config",
				CONFIG_PATH,
				"--print-config",
				path.join(REPO_ROOT, story),
			],
			{ cwd: REPO_ROOT, encoding: "utf8" },
		);
		const applied = new Set(
			((jsonc.parse(output) as { overrides?: unknown[] }).overrides ?? []).map(
				(_, index) => index,
			),
		);
		expect(
			storybookIndexes.some((index) => applied.has(index)),
			`storybook override should apply to ${story}`,
		).toBe(true);
	});
});
