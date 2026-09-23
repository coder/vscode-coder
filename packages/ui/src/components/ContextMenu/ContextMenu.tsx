import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { MenuContent, type MenuContentProps } from "../Menu/Menu";

export const ContextMenu = ContextMenuPrimitive.Root;

export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent(props: MenuContentProps): React.JSX.Element {
	// Setting `side` also skips Base UI's context-menu offsets.
	return <MenuContent side="inline-end" align="start" {...props} />;
}
