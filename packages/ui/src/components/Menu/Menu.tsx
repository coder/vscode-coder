import { cx } from "#cx";

import { formatKeybinding, type Keybinding } from "../../keybinding";
import { Icon } from "../Icon/Icon";

import "./Menu.css";

import type { ComponentPropsWithRef, ElementType, ReactNode } from "react";

/**
 * Keybinding hint inside a menu item; `keys` takes a keybindings
 * contribution's fields and renders the current OS's native label style.
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

interface MenuPartOptions {
	/** The primitive's `ItemIndicator`, which checks the item in the gutter. */
	indicator?: ElementType;
	/** Appends the trailing submenu chevron. */
	chevron?: boolean;
}

/**
 * Applies a menu class to a Radix part. ContextMenu and DropdownMenu each own
 * a separate Radix scope, so both build their parts from their own primitives.
 */
export function menuPart<T extends ElementType>(
	Part: T,
	base: string,
	{ indicator: Indicator, chevron }: MenuPartOptions = {},
): (props: ComponentPropsWithRef<T>) => React.JSX.Element {
	const Component: ElementType = Part;

	function MenuPart({
		className,
		children,
		...props
	}: {
		className?: string;
		children?: ReactNode;
	}): React.JSX.Element {
		return (
			<Component {...props} className={cx(base, className)}>
				{Indicator ? (
					<Indicator asChild>
						<Icon name="check" />
					</Indicator>
				) : null}
				{children}
				{chevron ? (
					<Icon name="chevron-right" className="ui-menu__submenu-indicator" />
				) : null}
			</Component>
		);
	}
	MenuPart.displayName = base;

	return MenuPart;
}
