import { useState } from "react";

import { PIXEL_ALL_THEMES } from "./storybook";
import { useVscodeTheme, type VscodeThemeKind } from "./useVscodeTheme";

import type { Meta, StoryObj } from "@storybook/react-vite";

/** All `--ui-*` tokens declared in loaded stylesheets, so the story stays in sync with tokens.css. */
function uiTokens(): string[] {
	const tokens = new Set<string>();
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		for (const rule of Array.from(rules)) {
			if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
				for (const property of Array.from(rule.style)) {
					if (property.startsWith("--ui-")) {
						tokens.add(property);
					}
				}
			}
		}
	}
	return Array.from(tokens);
}

/* Live view of the resolved custom properties. */
const ROOT_STYLES = getComputedStyle(document.documentElement);

/* Checkerboard so transparent and near-background swatches stay visible. */
const swatchBackdrop: React.CSSProperties = {
	width: "1rem",
	height: "1rem",
	flexShrink: 0,
	border: "1px solid var(--ui-description-foreground)",
	backgroundImage:
		"linear-gradient(45deg, #999 25%, #0000 25% 75%, #999 75%), " +
		"linear-gradient(45deg, #999 25%, #0000 25% 75%, #999 75%)",
	backgroundSize: "8px 8px",
	backgroundPosition: "0 0, 4px 4px",
};

const Foundations = (): React.JSX.Element => {
	const theme = useVscodeTheme();
	// Remount to re-read values; the compiler drops deps-array-only triggers.
	return <TokenTable key={theme} theme={theme} />;
};

const TokenTable = ({
	theme,
}: {
	theme: VscodeThemeKind;
}): React.JSX.Element => {
	const [tokens] = useState(uiTokens);
	// Read once per mount; the decorator applies the theme before render.
	const [values] = useState(
		() =>
			new Map(
				tokens.map((token) => [
					token,
					ROOT_STYLES.getPropertyValue(token).trim(),
				]),
			),
	);
	const fontTokens = tokens.filter((token) => token.includes("font"));
	const colorTokens = tokens.filter((token) => !token.includes("font"));

	return (
		<div
			style={{
				fontFamily: "var(--ui-font-family)",
				fontSize: "var(--ui-font-size)",
				fontWeight: "var(--ui-font-weight)",
				color: "var(--ui-foreground)",
				background: "var(--ui-background)",
				border: "1px solid var(--ui-border)",
				padding: "1rem",
			}}
		>
			<p>
				Theme kind: <code>{theme}</code>
			</p>
			<p style={{ color: "var(--ui-description-foreground)" }}>
				This text is set with {fontTokens.join(", ")}.
			</p>
			<ul
				style={{
					listStyle: "none",
					padding: 0,
					margin: 0,
					display: "grid",
					gridTemplateColumns: "auto auto 1fr",
					gap: "0.25rem 0.75rem",
					alignItems: "center",
				}}
			>
				{colorTokens.map((token) => (
					<li key={token} style={{ display: "contents" }}>
						<span style={swatchBackdrop}>
							<span
								style={{
									display: "block",
									width: "100%",
									height: "100%",
									background: `var(${token})`,
								}}
							/>
						</span>
						<code>{token}</code>
						<code
							style={{
								color: "var(--ui-description-foreground)",
								backgroundColor: "transparent",
							}}
						>
							{values.get(token) || "unset"}
						</code>
					</li>
				))}
			</ul>
		</div>
	);
};

const meta: Meta<typeof Foundations> = {
	title: "UI/Foundations",
	component: Foundations,
	parameters: {
		// Snapshot every theme; tokens are the single theming surface, so this
		// is where theme regressions show up.
		pixel: PIXEL_ALL_THEMES,
	},
};

export default meta;
type Story = StoryObj<typeof Foundations>;

export const Tokens: Story = {};
