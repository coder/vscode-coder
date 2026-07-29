import { useSyncExternalStore } from "react";

/** Theme kinds VS Code reports via the `data-vscode-theme-kind` body attribute. */
export type VscodeThemeKind =
	"light" | "dark" | "high-contrast" | "high-contrast-light";

const THEME_KIND_ATTRIBUTE = "data-vscode-theme-kind";
const THEME_ID_ATTRIBUTE = "data-vscode-theme-id";

const THEME_KINDS: ReadonlyMap<string, VscodeThemeKind> = new Map([
	["vscode-light", "light"],
	["vscode-dark", "dark"],
	["vscode-high-contrast", "high-contrast"],
	["vscode-high-contrast-light", "high-contrast-light"],
]);

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

/** `<kind> <id>`, so a switch between two themes of one kind also changes it. */
function getThemeSignature(): string {
	const { body } = document;
	return `${body.getAttribute(THEME_KIND_ATTRIBUTE)} ${body.getAttribute(THEME_ID_ATTRIBUTE)}`;
}

/**
 * The active VS Code theme kind, re-read on every theme switch so token
 * values read in JS never go stale.
 */
export function useVscodeTheme(): VscodeThemeKind {
	const [kind] = useSyncExternalStore(subscribe, getThemeSignature).split(" ");
	return THEME_KINDS.get(kind) ?? "dark";
}
