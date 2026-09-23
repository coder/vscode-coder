import { Icon } from "../Icon/Icon";

import {
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuKeybinding,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubTrigger,
} from "./Menu";

export const MenuExampleItems = (): React.JSX.Element => (
	<>
		<MenuItem>
			<Icon name="play" />
			Start workspace
		</MenuItem>
		<MenuItem disabled>
			<Icon name="stop-circle" />
			Stop
		</MenuItem>
		<MenuItem>
			Rebuild
			<MenuKeybinding keys={{ key: "ctrl+shift+r", mac: "cmd+shift+r" }} />
		</MenuItem>
		<MenuSeparator />
		<MenuCheckboxItem checked>Start on connect</MenuCheckboxItem>
		<MenuSeparator />
		<MenuRadioGroup value="name">
			<MenuLabel>Sort by</MenuLabel>
			<MenuRadioItem value="name">Name</MenuRadioItem>
			<MenuRadioItem value="status">Status</MenuRadioItem>
		</MenuRadioGroup>
		<MenuSeparator />
		<MenuSub defaultOpen>
			<MenuSubTrigger>More actions</MenuSubTrigger>
			<MenuContent>
				<MenuItem>Open logs</MenuItem>
				<MenuItem>Edit settings</MenuItem>
			</MenuContent>
		</MenuSub>
	</>
);
