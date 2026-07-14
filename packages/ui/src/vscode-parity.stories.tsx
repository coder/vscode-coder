import {
	VscodeBadge,
	VscodeButton,
	VscodeIcon,
	VscodeProgressBar,
	VscodeProgressRing,
	VscodeTextfield,
	VscodeToolbarButton,
} from "@vscode-elements/react-elements";

import "./components/control.css";
import { IconButton } from "./components/IconButton/IconButton";
import { ProgressBar } from "./components/ProgressBar/ProgressBar";
import { SearchInput } from "./components/SearchInput/SearchInput";
import { Spinner } from "./components/Spinner/Spinner";
import "./components/StatePanel/StatePanel.css";
import { StatusPill } from "./components/StatusPill/StatusPill";
import { FourThemeModes } from "./storybook";

import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Renders every `@repo/ui` control next to its `@vscode-elements`
 * counterpart under identical theme variables. Chromatic snapshots this
 * in all four themes, so any drift from VS Code's appearance shows up as
 * a visual diff.
 */
const Row = ({
	label,
	ours,
	reference,
}: {
	label: string;
	ours: React.ReactNode;
	reference: React.ReactNode;
}): React.JSX.Element => (
	<>
		<div>{label}</div>
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
			{ours}
		</div>
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
			{reference}
		</div>
	</>
);

const Parity = (): React.JSX.Element => (
	<div
		style={{
			display: "grid",
			gridTemplateColumns: "90px 200px 200px",
			gap: "12px 16px",
			alignItems: "center",
			fontSize: "13px",
		}}
	>
		<Row
			label="Toolbar"
			ours={
				<>
					<IconButton icon="refresh" label="Refresh" />
					<IconButton icon="pinned" label="Pinned" aria-pressed="true" />
				</>
			}
			reference={
				<>
					<VscodeToolbarButton icon="refresh" label="Refresh" />
					<VscodeToolbarButton
						icon="pinned"
						label="Pinned"
						toggleable
						checked
					/>
				</>
			}
		/>
		<Row
			label="Search"
			ours={
				<SearchInput
					value="development"
					onChange={() => undefined}
					style={{ width: "180px" }}
				/>
			}
			reference={
				<VscodeTextfield
					type="search"
					value="development"
					style={{ width: "180px" }}
				>
					<VscodeIcon slot="content-before" name="search" />
				</VscodeTextfield>
			}
		/>
		<Row
			label="Button"
			// Narrower than the reference by design: VS Code core's
			// monaco-text-button uses 4px/8px padding; vscode-elements uses 13px.
			ours={
				<div className="ui-state-panel__action" style={{ margin: 0 }}>
					<button type="button">Try again</button>
				</div>
			}
			reference={<VscodeButton>Try again</VscodeButton>}
		/>
		<Row
			label="Progress"
			ours={
				<ProgressBar value={42} label="Progress" style={{ width: "180px" }} />
			}
			reference={<VscodeProgressBar value={42} style={{ width: "180px" }} />}
		/>
		<Row
			label="Spinner"
			ours={<Spinner />}
			reference={<VscodeProgressRing />}
		/>
		<Row
			label="Badge"
			ours={
				<>
					<StatusPill icon="check" tone="success">
						Running
					</StatusPill>
					<StatusPill icon="error" tone="danger">
						Failed
					</StatusPill>
				</>
			}
			reference={
				<>
					<VscodeBadge variant="counter">Running</VscodeBadge>
					<VscodeBadge variant="counter">Failed</VscodeBadge>
				</>
			}
		/>
	</div>
);

const meta: Meta<typeof Parity> = {
	title: "UI/VSCodeParity",
	component: Parity,
	parameters: { chromatic: { modes: FourThemeModes } },
};
export default meta;
type Story = StoryObj<typeof Parity>;

export const SideBySide: Story = {};
