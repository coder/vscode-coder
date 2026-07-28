export type KeybindingPlatform = "mac" | "win" | "linux";

/**
 * A binding serialization, or one per platform using the same fields as a
 * package.json keybindings contribution (`key` is the fallback).
 */
export type Keybinding =
	string | { key?: string; mac?: string; win?: string; linux?: string };

type Modifier = "ctrl" | "shift" | "alt" | "meta";

const MODIFIER_ORDER: readonly Modifier[] = ["ctrl", "shift", "alt", "meta"];

/* Modifier tokens as VS Code serializes them, aliases included */
const MODIFIER_TOKENS: Readonly<Record<string, Modifier>> = {
	ctrl: "ctrl",
	shift: "shift",
	alt: "alt",
	meta: "meta",
	cmd: "meta",
	win: "meta",
	super: "meta",
};

const MODIFIER_LABELS: Readonly<
	Record<KeybindingPlatform, Readonly<Record<Modifier, string>>>
> = {
	mac: { ctrl: "⌃", shift: "⇧", alt: "⌥", meta: "⌘" },
	win: { ctrl: "Ctrl", shift: "Shift", alt: "Alt", meta: "Windows" },
	linux: { ctrl: "Ctrl", shift: "Shift", alt: "Alt", meta: "Super" },
};

/* Serialization tokens whose native label differs from capitalization */
const KEY_LABELS: Readonly<Record<string, string>> = {
	up: "UpArrow",
	down: "DownArrow",
	left: "LeftArrow",
	right: "RightArrow",
	pageup: "PageUp",
	pagedown: "PageDown",
	delete: "Del",
};

function detectPlatform(): KeybindingPlatform {
	// Keybindings follow the client machine, which is what the webview's
	// user agent reports even in remote sessions.
	const agent = navigator.userAgent;
	if (agent.includes("Mac")) {
		return "mac";
	}
	if (agent.includes("Windows")) {
		return "win";
	}
	return "linux";
}

function keyLabel(token: string): string {
	const label = KEY_LABELS[token];
	if (label) {
		return label;
	}
	if (token.length === 1 || /^f\d+$/.test(token)) {
		return token.toUpperCase();
	}
	// ponytail: capitalization covers enter/escape/tab/space/home/end;
	// extend KEY_LABELS if a menu ever needs numpad or OEM key names
	return token.charAt(0).toUpperCase() + token.slice(1);
}

function formatChord(chord: string, platform: KeybindingPlatform): string {
	const labels = MODIFIER_LABELS[platform];
	const modifiers = new Set<Modifier>();
	let key = "";
	for (const token of chord.toLowerCase().split("+")) {
		const modifier = MODIFIER_TOKENS[token];
		if (modifier) {
			modifiers.add(modifier);
		} else if (token) {
			key = token;
		}
	}
	const parts = MODIFIER_ORDER.filter((modifier) =>
		modifiers.has(modifier),
	).map((modifier) => labels[modifier]);
	if (key) {
		parts.push(keyLabel(key));
	}
	return parts.join(platform === "mac" ? "" : "+");
}

/**
 * Renders a keybinding serialization ("ctrl+shift+r", chords separated by
 * spaces) the way native menus label it on the current (or given) platform:
 * `⇧⌘R` on macOS, `Ctrl+Shift+R` elsewhere (VS Code's UILabelProvider and
 * key code uiMap). VS Code gives extensions no way to look up the effective
 * binding for a command, so callers pass their contributed defaults.
 */
export function formatKeybinding(
	keybinding: Keybinding,
	platform: KeybindingPlatform = detectPlatform(),
): string {
	const serialized =
		typeof keybinding === "string"
			? keybinding
			: (keybinding[platform] ?? keybinding.key);
	if (!serialized) {
		return "";
	}
	return serialized
		.trim()
		.split(/\s+/)
		.map((chord) => formatChord(chord, platform))
		.join(" ");
}
