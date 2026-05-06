import { mergeConfig } from "vite";

import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
	stories: ["../packages/*/src/**/*.stories.@(ts|tsx)"],
	addons: ["@storybook/addon-essentials", "@storybook/addon-a11y"],
	framework: {
		name: "@storybook/react-vite",
		options: {},
	},
	viteFinal(baseConfig) {
		return mergeConfig(baseConfig, {
			assetsInclude: ["**/*.ttf", "**/*.woff", "**/*.woff2"],
		});
	},
};

export default config;
