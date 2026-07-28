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

/* Pixel's autofit crop follows in-flow layout, but portalled overlays
   (menus, tooltips) are out of flow and would be cropped away. Grow the
   story root to cover any element portalled to body. Relies on the
   padded (top-left anchored) layout: growth only extends right and
   down, so already-positioned overlays never move. */
function fitRootToPortals(): void {
	const root = document.getElementById("root");
	if (!root) {
		return;
	}
	const origin = root.getBoundingClientRect();
	let right = 0;
	let bottom = 0;
	for (const el of document.body.children) {
		// Skip Storybook chrome (root, loaders, error display, a11y helpers)
		if (
			!(el instanceof HTMLElement) ||
			el.id.startsWith("storybook-") ||
			el.classList.contains("sb-wrapper")
		) {
			continue;
		}
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			continue;
		}
		right = Math.max(right, rect.right - origin.left);
		bottom = Math.max(bottom, rect.bottom - origin.top);
	}
	if (right > 0 && bottom > 0) {
		// Slack keeps shadows and focus outlines in frame
		root.style.minWidth = `${Math.ceil(right) + 16}px`;
		root.style.minHeight = `${Math.ceil(bottom) + 16}px`;
	}
}

const preview: Preview = {
	parameters: {
		// Top-left anchored; fitRootToPortals depends on this
		layout: "padded",
	},
	beforeEach: () => {
		// Undo fitRootToPortals sizing when dev story switches reuse the root
		const root = document.getElementById("root");
		root?.style.removeProperty("min-width");
		root?.style.removeProperty("min-height");
	},
	afterEach: fitRootToPortals,
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
