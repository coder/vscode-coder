import { useVscodeTheme } from "./useVscodeTheme";

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

const Foundations = (): React.JSX.Element => {
	const theme = useVscodeTheme();
	const tokens = uiTokens();
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
			<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
				{colorTokens.map((token) => (
					<li
						key={token}
						style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
					>
						<span
							style={{
								width: "1rem",
								height: "1rem",
								flexShrink: 0,
								background: `var(${token})`,
								border: "1px solid var(--ui-contrast-border)",
							}}
						/>
						<code>{token}</code>
					</li>
				))}
			</ul>
		</div>
	);
};

const meta: Meta<typeof Foundations> = {
	title: "UI/Foundations",
	component: Foundations,
};

export default meta;
type Story = StoryObj<typeof Foundations>;

export const Tokens: Story = {};
