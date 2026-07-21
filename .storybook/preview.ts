/// <reference types="vite/client" />

import codiconCssUrl from "@vscode/codicons/dist/codicon.css?url";
import { theme as darkTheme } from "@vscode-elements/webview-playground/dist/themes/dark-v2.js";
import { theme as hcDarkTheme } from "@vscode-elements/webview-playground/dist/themes/hc-dark.js";
import { theme as hcLightTheme } from "@vscode-elements/webview-playground/dist/themes/hc-light.js";
import { theme as lightTheme } from "@vscode-elements/webview-playground/dist/themes/light-v2.js";
import { createElement, useEffect } from "react";

import "./global.css";

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

// VS Code injects --vscode-font-family at runtime, but the upstream
// vscode-elements theme data omits it. Set a static default so
// Storybook (and Pixel) renders with a predictable sans-serif
// stack instead of falling back to the browser default (Times).
const VSCODE_FONT_FAMILY =
	'"Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif';

const THEMES: Record<
	string,
	{ variables: Array<[string, string]>; kind: string }
> = {
	light: { variables: lightTheme, kind: "vscode-light" },
	dark: { variables: darkTheme, kind: "vscode-dark" },
	"high-contrast": { variables: hcDarkTheme, kind: "vscode-high-contrast" },
	"high-contrast-light": {
		variables: hcLightTheme,
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
				root.setProperty("--vscode-font-family", VSCODE_FONT_FAMILY);

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
					root.removeProperty("--vscode-font-family");
					document.body.removeAttribute("data-vscode-theme-kind");
				};
			}, [variables, kind]);

			return createElement("div", { id: "root" }, createElement(Story));
		},
	],
};

export default preview;
