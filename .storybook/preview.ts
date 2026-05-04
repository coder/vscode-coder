import "./global.css";
import codiconCssUrl from "@vscode/codicons/dist/codicon.css?url";

import type { Preview } from "@storybook/react";
import { theme } from "./themes/dark";
import { createElement, useEffect } from "react";

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

const getDefaultFontStack = () => {
	if (navigator.userAgent.indexOf("Linux") > -1) {
		return 'system-ui, "Ubuntu", "Droid Sans", sans-serif';
	} else if (navigator.userAgent.indexOf("Mac") > -1) {
		return "-apple-system, BlinkMacSystemFont, sans-serif";
	} else if (navigator.userAgent.indexOf("Windows") > -1) {
		return '"Segoe WPC", "Segoe UI", sans-serif';
	} else {
		return "sans-serif";
	}
};

const preview: Preview = {
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story, context) => {
			useEffect(() => {
				// Apply CSS custom properties to the document root
				theme.forEach(([property, value]) => {
					document.documentElement.style.setProperty(property, value);
				});

				// Cleanup function to remove properties when unmounting
				return () => {
					theme.forEach(([property]) => {
						document.documentElement.style.removeProperty(property);
					});
					document.documentElement.style.removeProperty("font-family");
				};
			}, []);

			useEffect(() => {
				if (context.tags.includes("tasks")) {
					// Dynamically import tasks CSS
					import("../packages/tasks/src/index.css");
				}
			}, [context.tags]);

			return createElement(
				"div",
				{
					id: "root",
					style: {
						fontFamily: getDefaultFontStack(),
					},
				},
				Story(),
			);
		},
	],
};

export default preview;
