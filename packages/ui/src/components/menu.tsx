import { cx } from "#cx";

import { formatKeybinding, type Keybinding } from "./keybinding";
import "./menu.css";

import type { ComponentPropsWithRef } from "react";

/**
 * Right-aligned keybinding hint inside a menu item, dimmed like native.
 * `keys` takes the fields of a keybindings contribution and renders the
 * current OS's binding in its native label style.
 */
export function MenuKeybinding({
	keys,
	className,
	...props
}: Omit<ComponentPropsWithRef<"span">, "children"> & {
	keys: Keybinding;
}): React.JSX.Element {
	return (
		<span {...props} className={cx("ui-menu__keybinding", className)}>
			{formatKeybinding(keys)}
		</span>
	);
}
