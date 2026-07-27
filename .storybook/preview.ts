/// <reference types="vite/client" />

import codiconCssUrl from "@vscode/codicons/dist/codicon.css?url";
import { createElement } from "react";

import "./global.css";
import "./themes/generated/default-styles.css";
import themeDumps from "./themes/generated/themes.json";

import type { Preview } from "@storybook/react-vite";
import type { WebviewApi } from "vscode-webview";

// Auto-import per-package Storybook CSS entry points
import.meta.glob("../packages/*/storybook.preview.ts", { eager: true });

declare global {
	interface Window {
		acquireVsCodeApi?: <T = unknown>() => WebviewApi<T>;
	}
}

// Mock the acquireVsCodeApi function for Storybook, so that components
// that rely on it can function without errors.
if (typeof window !== "undefined") {
	window.acquireVsCodeApi ??= () => ({
		postMessage: () => undefined,
		getState: () => undefined,
		setState: (state) => state,
	});
}

// Inject codicon stylesheet immediately (before any components render)
// Must be a <link> element with id "vscode-codicon-stylesheet" for vscode-elements
if (
	typeof document !== "undefined" &&
	!document.getElementById("vscode-codicon-stylesheet")
) {
	const link = document.createElement("link");
	link.id = "vscode-codicon-stylesheet";
	link.rel = "stylesheet";
	link.href = codiconCssUrl;
	document.head.appendChild(link);
}

/**
 * Applies a captured VS Code theme dump (`pnpm sync:vscode-themes`) as one
 * `:root` stylesheet and mirrors VS Code's body attribute for theme-aware
 * hooks. Synchronous and idempotent, so stories render fully themed.
 */
let appliedTheme: string | undefined;

function applyTheme(requested: string): void {
	const slug = (
		requested in themeDumps.themes ? requested : "dark"
	) as keyof typeof themeDumps.themes;
	if (appliedTheme === slug) {
		return;
	}
	appliedTheme = slug;

	let style = document.getElementById("vscode-theme-variables");
	if (!style) {
		style = document.createElement("style");
		style.id = "vscode-theme-variables";
		document.head.appendChild(style);
	}
	style.textContent = `:root {${themeDumps.themes[slug]
		.map(([property, value]) => `${property}: ${value};`)
		.join("")}}`;
	document.body.setAttribute("data-vscode-theme-kind", `vscode-${slug}`);
}

const preview: Preview = {
	parameters: {
		layout: "centered",
	},
	globalTypes: {
		theme: {
			description: "Global theme for components",
			defaultValue: "dark",
			toolbar: {
				title: "Theme",
				icon: "circlehollow",
				items: [
					{ value: "light", icon: "circlehollow", title: "Light" },
					{ value: "dark", icon: "circle", title: "Dark" },
					{
						value: "high-contrast",
						icon: "contrast",
						title: "High Contrast",
					},
					{
						value: "high-contrast-light",
						icon: "sun",
						title: "High Contrast Light",
					},
				],
				dynamicTitle: true,
			},
		},
	},
	decorators: [
		(Story, context) => {
			applyTheme(context.globals.theme as string);
			return createElement(
				"div",
				{
					id: "root",
					style: { width: context.parameters.rootWidth as string },
				},
				createElement(Story),
			);
		},
	],
};

export default preview;
