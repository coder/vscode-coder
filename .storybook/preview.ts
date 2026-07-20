/// <reference types="vite/client" />

import codiconCssUrl from "@vscode/codicons/dist/codicon.css?url";
import { createElement, useEffect } from "react";

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
 * Theme variable dumps captured from a real VS Code instance.
 * Regenerate with `pnpm sync:vscode-themes`.
 */
const THEMES: Readonly<
	Record<string, { variables: readonly string[][]; kind: string }>
> = {
	light: { variables: themeDumps.themes.light, kind: "vscode-light" },
	dark: { variables: themeDumps.themes.dark, kind: "vscode-dark" },
	"high-contrast": {
		variables: themeDumps.themes["high-contrast"],
		kind: "vscode-high-contrast",
	},
	"high-contrast-light": {
		variables: themeDumps.themes["high-contrast-light"],
		kind: "vscode-high-contrast-light",
	},
};

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
			const { variables, kind } =
				THEMES[context.globals.theme as string] ?? THEMES.dark;

			useEffect(() => {
				const root = document.documentElement.style;

				// Mirror VS Code's body attribute so theme-aware hooks work in Storybook.
				document.body.setAttribute("data-vscode-theme-kind", kind);

				// Apply CSS custom properties to the document root
				variables.forEach(([property, value]) => {
					root.setProperty(property, value);
				});

				// Cleanup function to remove properties when unmounting
				return () => {
					variables.forEach(([property]) => {
						root.removeProperty(property);
					});
					document.body.removeAttribute("data-vscode-theme-kind");
				};
			}, [variables, kind]);

			return createElement("div", { id: "root" }, createElement(Story));
		},
	],
};

export default preview;
