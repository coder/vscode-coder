import * as SelectPrimitive from "@radix-ui/react-select";

import { cx } from "#cx";

import "../control.css";
import { Icon } from "../Icon/Icon";
import "../overlay.css";

import "./Select.css";

import type { ComponentPropsWithRef, ReactNode } from "react";

/** Root state container. */
export const Select = SelectPrimitive.Root;

/** Renders the selected item's text, or `placeholder` when empty. */
export const SelectValue = SelectPrimitive.Value;

/** The closed control: current value and a chevron, styled like the
    native dropdown. */
export function SelectTrigger({
	className,
	children,
	...props
}: ComponentPropsWithRef<typeof SelectPrimitive.Trigger>): React.JSX.Element {
	return (
		<SelectPrimitive.Trigger
			{...props}
			className={cx("ui-control", "ui-select__trigger", className)}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<Icon name="chevron-down" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

/** The floating option list, portalled to `body` and sized to the trigger.
    Like the native select dropdown it appears without animation. */
export function SelectContent({
	className,
	children,
	...props
}: ComponentPropsWithRef<typeof SelectPrimitive.Content>): React.JSX.Element {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				position="popper"
				sideOffset={2}
				{...props}
				className={cx("ui-overlay", "ui-select__list", className)}
			>
				<SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

export interface SelectItemProps extends ComponentPropsWithRef<
	typeof SelectPrimitive.Item
> {
	description?: ReactNode;
}

/** One option row; the highlighted row marks selection, like the native
    list. An optional description renders as a muted second line. */
export function SelectItem({
	className,
	children,
	description,
	...props
}: SelectItemProps): React.JSX.Element {
	return (
		<SelectPrimitive.Item
			{...props}
			className={cx("ui-select__item", className)}
		>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
			{description !== undefined && (
				<span className="ui-select__item-description">{description}</span>
			)}
		</SelectPrimitive.Item>
	);
}
