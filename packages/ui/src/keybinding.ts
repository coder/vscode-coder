export type KeybindingPlatform = "mac" | "win" | "linux";

/**
 * A binding serialization, optionally overridden per platform, using the same
 * fields as a `contributes.keybindings` entry.
 */
export type Keybinding =
	string | ({ key: string } & Partial<Record<KeybindingPlatform, string>>);

const MODIFIER_ORDER = ["ctrl", "shift", "alt", "meta"] as const;

type Modifier = (typeof MODIFIER_ORDER)[number];

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

/* Capitalization covers enter/escape/tab/space/home/end and the F-keys; add
   numpad or OEM names to KEY_LABELS if a menu ever needs them. */
function keyLabel(token: string): string {
	return KEY_LABELS[token] ?? token.charAt(0).toUpperCase() + token.slice(1);
}

function formatChord(chord: string, platform: KeybindingPlatform): string {
	const labels = MODIFIER_LABELS[platform];
	const tokens = chord.toLowerCase().split("+").filter(Boolean);
	const modifiers = tokens.map((token) => MODIFIER_TOKENS[token]);
	const parts = MODIFIER_ORDER.filter((modifier) =>
		modifiers.includes(modifier),
	).map((modifier) => labels[modifier]);
	const key = tokens.findLast((token) => !MODIFIER_TOKENS[token]);
	if (key) {
		parts.push(keyLabel(key));
	}
	return parts.join(platform === "mac" ? "" : "+");
}

/**
 * Renders a keybinding serialization ("ctrl+shift+r", chords separated by
 * spaces) the way native menus label it on the current (or given) platform:
 * `⇧⌘R` on macOS, `Ctrl+Shift+R` elsewhere (VS Code's UILabelProvider and
 * key code uiMap).
 */
export function formatKeybinding(
	keybinding: Keybinding,
	platform: KeybindingPlatform = detectPlatform(),
): string {
	const serialized =
		typeof keybinding === "string"
			? keybinding
			: (keybinding[platform] ?? keybinding.key);
	return serialized
		.trim()
		.split(/\s+/)
		.map((chord) => formatChord(chord, platform))
		.join(" ");
}
