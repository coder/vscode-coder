import { useSyncExternalStore } from "react";

/** Theme kinds VS Code reports via the `data-vscode-theme-kind` body attribute. */
export type VscodeThemeKind =
	"light" | "dark" | "high-contrast" | "high-contrast-light";

const THEME_KIND_ATTRIBUTE = "data-vscode-theme-kind";
const THEME_ID_ATTRIBUTE = "data-vscode-theme-id";

// One shared observer no matter how many components use the hook.
const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;

function subscribe(onChange: () => void): () => void {
	if (!observer) {
		observer = new MutationObserver(() => {
			listeners.forEach((listener) => listener());
		});
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: [THEME_KIND_ATTRIBUTE, THEME_ID_ATTRIBUTE],
		});
	}
	listeners.add(onChange);
	return (): void => {
		listeners.delete(onChange);
		if (listeners.size === 0) {
			observer?.disconnect();
			observer = undefined;
		}
	};
}

function getThemeKind(): VscodeThemeKind {
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

/* The kind alone misses switches between two themes of the same kind */
function getSnapshot(): string {
	return `${document.body.getAttribute(THEME_ID_ATTRIBUTE)}\n${document.body.getAttribute(THEME_KIND_ATTRIBUTE)}`;
}

/**
 * The active VS Code theme kind. Re-renders on any theme switch, including
 * between two themes of the same kind, so token values read in JS never
 * go stale.
 */
export function useVscodeTheme(): VscodeThemeKind {
	useSyncExternalStore(subscribe, getSnapshot);
	return getThemeKind();
}
