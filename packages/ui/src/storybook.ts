import "./story-helpers.css";

export const FOUR_THEME_MODES = {
	light: { theme: "light" },
	dark: { theme: "dark" },
	"high-contrast": { theme: "high-contrast" },
	"high-contrast-light": { theme: "high-contrast-light" },
} as const;

/* Story stand-in for a webview-styled button. */
export const STORY_TRIGGER_CLASS = "story-trigger";
