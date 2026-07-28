import { expect, screen, userEvent, waitFor } from "storybook/test";

/**
 * Pixel matrix override (`parameters.pixel`) that snapshots a story in every
 * captured VS Code theme; the base matrix in pixel.jsonc is light/dark only.
 */
export const PIXEL_ALL_THEMES = {
	matrix: {
		themes: ["light", "dark", "high-contrast", "high-contrast-light"],
	},
} as const;

/* Opens the focused menu's submenu; keyboard skips the hover-open delay. */
export async function openSubmenuByKeyboard(itemName: string): Promise<void> {
	const menu = await screen.findByRole("menu");
	await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
	await userEvent.keyboard("{End}{ArrowRight}");
	await screen.findByRole("menuitem", { name: itemName });
}
