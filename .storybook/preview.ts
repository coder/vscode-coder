import codiconCssUrl from "@vscode/codicons/dist/codicon.css?url";
import { createElement, useEffect } from "react";

import "./global.css";
import { darkTheme } from "./themes/dark-v2";
import { lightTheme } from "./themes/light-v2";

import type { Preview } from "@storybook/react-vite";
import type { WebviewApi } from "vscode-webview";

// Mock the acquireVsCodeApi function for Storybook, so that components
// that rely on it can function without errors.
if (
	typeof window !== "undefined" &&
	!(window as { acquireVsCodeApi?: () => WebviewApi<unknown> }).acquireVsCodeApi
) {
	(window as { acquireVsCodeApi: () => WebviewApi<unknown> }).acquireVsCodeApi =
		() => ({
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

// This allows the system viewing the storybook to use the same font
// stack as vscode, which is important for accurate rendering of text.
const getDefaultFontStack = () => {
	if (navigator.userAgent.includes("Linux")) {
		return 'system-ui, "Ubuntu", "Droid Sans", sans-serif';
	} else if (navigator.userAgent.includes("Mac")) {
		return "-apple-system, BlinkMacSystemFont, sans-serif";
	} else if (navigator.userAgent.includes("Windows")) {
		return '"Segoe WPC", "Segoe UI", sans-serif';
	} else {
		return "sans-serif";
	}
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
				// Apply CSS custom properties to the document root
				selectedTheme.forEach(([property, value]) => {
					document.documentElement.style.setProperty(property, value);
				});

				// Cleanup function to remove properties when unmounting
				return () => {
					selectedTheme.forEach(([property]) => {
						document.documentElement.style.removeProperty(property);
					});
				};
			}, [selectedTheme]);

			return createElement(
				"div",
				{
					id: "root",
					style: {
						fontFamily: getDefaultFontStack(),
					},
				},
				createElement(Story),
			);
		},
	],
};

export default preview;
