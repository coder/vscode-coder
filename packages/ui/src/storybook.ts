/**
 * Pixel matrix override (`parameters.pixel`) that snapshots a story in every
 * captured VS Code theme; the base matrix in pixel.jsonc is light/dark only.
 */
export const PIXEL_ALL_THEMES = {
	matrix: {
		themes: ["light", "dark", "high-contrast", "high-contrast-light"],
	},
} as const;
