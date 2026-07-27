import babel from "@rolldown/plugin-babel";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import { mergeConfig } from "vite";

import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
	stories: ["../packages/*/src/**/*.stories.@(ts|tsx)"],
	addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
	framework: {
		name: "@storybook/react-vite",
		options: {},
	},
	viteFinal(baseConfig) {
		return mergeConfig(baseConfig, {
			assetsInclude: ["**/*.ttf", "**/*.woff", "**/*.woff2"],
			// Compile with the React Compiler, matching production webview builds
			plugins: [babel({ presets: [reactCompilerPreset()] })],
		});
	},
};

export default config;
