import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cx } from "#cx";

import "../menu.css";

import type { ComponentPropsWithRef } from "react";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export function DropdownMenuContent({
	className,
	sideOffset = 2,
	align = "start",
	// Native menus wrap focus when arrowing past the last item
	loop = true,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.Content
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				{...props}
				sideOffset={sideOffset}
				align={align}
				loop={loop}
				collisionPadding={4}
				className={cx("ui-menu", className)}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

export function DropdownMenuSubContent({
	className,
	sideOffset = 2,
	loop = true,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.SubContent
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.SubContent
				{...props}
				sideOffset={sideOffset}
				loop={loop}
				collisionPadding={4}
				className={cx("ui-menu", className)}
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
			<span
				className="ui-menu__submenu-indicator codicon codicon-chevron-right"
				aria-hidden="true"
			/>
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
