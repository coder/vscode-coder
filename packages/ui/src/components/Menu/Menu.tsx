import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cx, type Styled } from "#cx";

import { formatKeybinding, type Keybinding } from "../../keybinding";
import { Icon } from "../Icon/Icon";
import "../overlay.css";

import "./Menu.css";

import type { ComponentPropsWithRef } from "react";

const ITEM_CLASS = "ui-overlay__item ui-menu__item";

/** Shortcut hint in the current OS's native label style. */
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

export const MenuSub = MenuPrimitive.SubmenuRoot;

export const MenuGroup = MenuPrimitive.Group;

export const MenuRadioGroup = MenuPrimitive.RadioGroup;

/** A leading `Icon` sits in the gutter. */
export function MenuItem({
	className,
	...props
}: Styled<
	ComponentPropsWithRef<typeof MenuPrimitive.Item>
>): React.JSX.Element {
	return (
		<MenuPrimitive.Item {...props} className={cx(ITEM_CLASS, className)} />
	);
}

/** Names the `MenuGroup` or `MenuRadioGroup` it sits in. */
export function MenuLabel({
	className,
	...props
}: Styled<
	ComponentPropsWithRef<typeof MenuPrimitive.GroupLabel>
>): React.JSX.Element {
	return (
		<MenuPrimitive.GroupLabel
			{...props}
			className={cx("ui-menu__label", className)}
		/>
	);
}

export function MenuSeparator({
	className,
	...props
}: Styled<
	ComponentPropsWithRef<typeof MenuPrimitive.Separator>
>): React.JSX.Element {
	return (
		<MenuPrimitive.Separator
			{...props}
			className={cx("ui-menu__separator", className)}
		/>
	);
}

export function MenuCheckboxItem({
	className,
	children,
	...props
}: Styled<
	ComponentPropsWithRef<typeof MenuPrimitive.CheckboxItem>
>): React.JSX.Element {
	return (
		<MenuPrimitive.CheckboxItem
			{...props}
			className={cx(ITEM_CLASS, className)}
		>
			<MenuPrimitive.CheckboxItemIndicator render={<Icon name="check" />} />
			{children}
		</MenuPrimitive.CheckboxItem>
	);
}

export function MenuRadioItem({
	className,
	children,
	...props
}: Styled<
	ComponentPropsWithRef<typeof MenuPrimitive.RadioItem>
>): React.JSX.Element {
	return (
		<MenuPrimitive.RadioItem {...props} className={cx(ITEM_CLASS, className)}>
			<MenuPrimitive.RadioItemIndicator render={<Icon name="check" />} />
			{children}
		</MenuPrimitive.RadioItem>
	);
}

export function MenuSubTrigger({
	className,
	children,
	...props
}: Styled<
	ComponentPropsWithRef<typeof MenuPrimitive.SubmenuTrigger>
>): React.JSX.Element {
	return (
		<MenuPrimitive.SubmenuTrigger
			{...props}
			className={cx(ITEM_CLASS, className)}
		>
			{children}
			<Icon name="chevron-right" className="ui-menu__submenu-indicator" />
		</MenuPrimitive.SubmenuTrigger>
	);
}

export type MenuContentProps = Styled<
	ComponentPropsWithRef<typeof MenuPrimitive.Popup>
> &
	Pick<
		ComponentPropsWithRef<typeof MenuPrimitive.Positioner>,
		"side" | "align" | "sideOffset" | "alignOffset"
	>;

/** Also a submenu's surface. Placement props go to the positioner, the rest to the menu. */
export function MenuContent({
	side,
	align,
	sideOffset = 2,
	alignOffset,
	className,
	...props
}: MenuContentProps): React.JSX.Element {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				// Fixed gets its own layer, which keeps text antialiasing greyscale.
				positionMethod="fixed"
				side={side}
				align={align}
				sideOffset={sideOffset}
				alignOffset={alignOffset}
				collisionPadding={4}
			>
				<MenuPrimitive.Popup
					{...props}
					className={cx("ui-overlay ui-menu", className)}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}
