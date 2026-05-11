/// <reference types="vite/client" />

import codiconCssUrl from "@vscode/codicons/dist/codicon.css?url";
import { createElement, useEffect } from "react";

import "./global.css";
import { darkTheme } from "./themes/dark-v2";
import { lightTheme } from "./themes/light-v2";

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
				],
				dynamicTitle: true,
			},
		},
	},
	decorators: [
		(Story, context) => {
			const selectedTheme =
				context.globals.theme === "light" ? lightTheme : darkTheme;

			useEffect(() => {
				const root = document.documentElement.style;

				// Apply CSS custom properties to the document root
				selectedTheme.forEach(([property, value]) => {
					root.setProperty(property, value);
				});

				// Cleanup function to remove properties when unmounting
				return () => {
					selectedTheme.forEach(([property]) => {
						root.removeProperty(property);
					});
					root.removeProperty("--vscode-font-family");
				};
			}, [selectedTheme]);

			return createElement("div", { id: "root" }, createElement(Story));
		},
	],
};

export default preview;
