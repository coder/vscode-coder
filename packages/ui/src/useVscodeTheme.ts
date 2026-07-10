import { useSyncExternalStore } from "react";

/** Theme kinds VS Code reports via the `data-vscode-theme-kind` body attribute. */
export type VscodeThemeKind =
	"light" | "dark" | "high-contrast" | "high-contrast-light";

const THEME_KIND_ATTRIBUTE = "data-vscode-theme-kind";

function subscribe(onChange: () => void): () => void {
	const observer = new MutationObserver(onChange);
	observer.observe(document.body, {
		attributes: true,
		attributeFilter: [THEME_KIND_ATTRIBUTE],
	});
	return (): void => {
		observer.disconnect();
	};
}

function getSnapshot(): VscodeThemeKind {
	switch (document.body.getAttribute(THEME_KIND_ATTRIBUTE)) {
		case "vscode-light":
			return "light";
		case "vscode-high-contrast":
			return "high-contrast";
		case "vscode-high-contrast-light":
			return "high-contrast-light";
		default:
			return "dark";
	}
}

/** The active VS Code theme kind; re-renders when the user switches themes. */
export function useVscodeTheme(): VscodeThemeKind {
	return useSyncExternalStore(subscribe, getSnapshot);
}
