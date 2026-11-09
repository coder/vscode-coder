import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { MenuContent, type MenuContentProps } from "../Menu/Menu";

import type { ComponentProps } from "react";

/** Non-modal: undoing a modal menu's scroll lock and backdrop flashes the webview. */
export function DropdownMenu({
	modal = false,
	...props
}: ComponentProps<typeof MenuPrimitive.Root>): React.JSX.Element {
	return <MenuPrimitive.Root modal={modal} {...props} />;
}

export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent(
	props: MenuContentProps,
): React.JSX.Element {
	return <MenuContent align="start" {...props} />;
}
