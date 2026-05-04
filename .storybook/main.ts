import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

type PackageManifest = {
	name?: string;
};

function getWorkspaceAliases(packagesDir: string): Record<string, string> {
	const aliases: Record<string, string> = {};

	for (const dirent of readdirSync(packagesDir)) {
		const packageDir = resolve(packagesDir, dirent);
		const packageJsonPath = resolve(packageDir, "package.json");
		const srcDir = resolve(packageDir, "src");

		if (!statSync(packageDir).isDirectory()) {
			continue;
		}

		try {
			const manifest = JSON.parse(
				readFileSync(packageJsonPath, "utf8"),
			) as PackageManifest;
			if (manifest.name?.startsWith("@repo/")) {
				aliases[manifest.name] = srcDir;
			}
		} catch {
			// Skip directories without a valid package.json.
		}
	}

	return aliases;
}

const storybookDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(storybookDir, "..");
const packagesDir = resolve(rootDir, "packages");

const config: StorybookConfig = {
	stories: ["../packages/*/src/**/*.stories.@(ts|tsx)"],
	addons: ["@storybook/addon-essentials", "@storybook/addon-a11y"],
	framework: {
		name: "@storybook/react-vite",
		options: {},
	},
	async viteFinal(baseConfig) {
		return mergeConfig(baseConfig, {
			resolve: {
				alias: getWorkspaceAliases(packagesDir),
			},
			assetsInclude: ["**/*.ttf", "**/*.woff", "**/*.woff2"],
		});
	},
};

export default config;
