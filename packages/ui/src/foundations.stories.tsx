import { useVscodeTheme } from "./useVscodeTheme";

import type { Meta, StoryObj } from "@storybook/react-vite";

const COLOR_TOKENS = [
	"--ui-foreground",
	"--ui-background",
	"--ui-description-foreground",
	"--ui-icon-foreground",
	"--ui-border",
	"--ui-focus-border",
	"--ui-hover-background",
	"--ui-active-selection-background",
	"--ui-active-selection-foreground",
	"--ui-inactive-selection-background",
	"--ui-link-foreground",
	"--ui-error-foreground",
	"--ui-warning-foreground",
	"--ui-contrast-border",
	"--ui-contrast-active-border",
];

const Foundations = (): React.JSX.Element => {
	const theme = useVscodeTheme();

	return (
		<div
			style={{
				fontFamily: "var(--ui-font-family)",
				fontSize: "var(--ui-font-size)",
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
				Semantic tokens mapped to VS Code theme variables.
			</p>
			<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
				{COLOR_TOKENS.map((token) => (
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
								border: "1px solid var(--ui-border)",
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
