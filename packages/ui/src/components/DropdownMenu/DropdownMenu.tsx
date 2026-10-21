import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { MenuContent, type MenuContentProps } from "../Menu/Menu";

import type { ComponentProps } from "react";

/**
 * Non-modal by default: a modal menu locks page scroll and covers the window
 * with a backdrop, and undoing both on close makes the webview flash.
 */
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
