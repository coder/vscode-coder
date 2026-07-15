/**
 * Pixel matrix override (`parameters.pixel`) that snapshots a story in every
 * captured VS Code theme; the base matrix in pixel.jsonc is light/dark only.
 */
export const PIXEL_ALL_THEMES = {
	matrix: {
		themes: ["light", "dark", "high-contrast", "high-contrast-light"],
	},
} as const;

/* Story stand-in for a webview-styled button. */
export const STORY_TRIGGER_CLASS = "story-trigger";

/* Reserves in-flow space for a portalled overlay so Pixel snapshots keep
   it in frame; anchor "bottom" pins the trigger low for overlays that
   open upward. */
export function overlaySpace(
	width: number,
	height: number,
	{ anchor = "top" }: { anchor?: "top" | "bottom" } = {},
): (Story: React.ComponentType) => React.JSX.Element {
	const style: React.CSSProperties =
		anchor === "bottom"
			? {
					width,
					height,
					// Keeps the trigger's focus outline inside the cropped bounds
					paddingBottom: 8,
					display: "flex",
					alignItems: "flex-end",
					justifyContent: "center",
				}
			: { width, height };
	return function OverlaySpace(Story) {
		return (
			<div style={style}>
				<Story />
			</div>
		);
	};
}
