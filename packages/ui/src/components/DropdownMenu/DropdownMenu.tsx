import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cx } from "#cx";

import { Icon } from "../Icon/Icon";
import "../menu.css";
import "../overlay.css";

import type { ComponentPropsWithRef } from "react";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export function DropdownMenuContent({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.Content
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				sideOffset={2}
				align="start"
				// Native menus wrap focus when arrowing past the last item
				loop
				collisionPadding={4}
				{...props}
				className={cx("ui-overlay ui-menu", className)}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

export function DropdownMenuSubContent({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.SubContent
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.SubContent
				sideOffset={2}
				loop
				collisionPadding={4}
				{...props}
				className={cx("ui-overlay ui-menu", className)}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

export function DropdownMenuItem({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.Item
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Item
			{...props}
			className={cx("ui-menu__item", className)}
		/>
	);
}

export function DropdownMenuSubTrigger({
	className,
	children,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.SubTrigger
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.SubTrigger
			{...props}
			className={cx("ui-menu__item", className)}
		>
			{children}
			<Icon name="chevron-right" className="ui-menu__submenu-indicator" />
		</DropdownMenuPrimitive.SubTrigger>
	);
}

export function DropdownMenuSeparator({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.Separator
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Separator
			{...props}
			className={cx("ui-menu__separator", className)}
		/>
	);
}
