import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { MenuContent, type MenuContentProps } from "../Menu/Menu";

export const DropdownMenu = MenuPrimitive.Root;

export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent(
	props: MenuContentProps,
): React.JSX.Element {
	return <MenuContent align="start" {...props} />;
}
