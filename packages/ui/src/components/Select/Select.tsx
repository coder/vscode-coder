import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import { cx, type Styled } from "#cx";

import "../control.css";
import { Icon } from "../Icon/Icon";
import "../overlay.css";

import "./Select.css";

export type SelectProps<Value> = Omit<
	SelectPrimitive.Root.Props<Value>,
	"items"
> & {
	/** The labels the trigger shows. */
	items:
		| Readonly<Record<string, ReactNode>>
		| ReadonlyArray<{ readonly value: Value; readonly label: ReactNode }>;
};

export function Select<Value>(props: SelectProps<Value>): React.JSX.Element {
	return <SelectPrimitive.Root {...props} />;
}

export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
	className,
	children,
	...props
}: Styled<
	ComponentPropsWithRef<typeof SelectPrimitive.Trigger>
>): React.JSX.Element {
	return (
		<SelectPrimitive.Trigger
			{...props}
			className={cx("ui-control", "ui-select__trigger", className)}
		>
			{children}
			<Icon name="chevron-down" />
		</SelectPrimitive.Trigger>
	);
}

/** `className` and `style` dress the panel; other props go to the listbox. */
export function SelectContent({
	className,
	style,
	...props
}: Styled<
	ComponentPropsWithRef<typeof SelectPrimitive.List>
>): React.JSX.Element {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				// Fixed gets its own layer, which keeps text antialiasing greyscale.
				positionMethod="fixed"
				alignItemWithTrigger={false}
				align="start"
				sideOffset={2}
				collisionPadding={10}
			>
				<SelectPrimitive.Popup
					className={cx("ui-overlay", "ui-select__list", className)}
					style={style}
				>
					<SelectPrimitive.List {...props} className="ui-select__viewport" />
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

export type SelectItemProps = Styled<
	ComponentPropsWithRef<typeof SelectPrimitive.Item>
> & {
	description?: ReactNode;
};

/** `description` renders as a muted second line. */
export function SelectItem({
	className,
	children,
	description,
	"aria-describedby": describedBy,
	...props
}: SelectItemProps): React.JSX.Element {
	const descriptionId = useId();
	const labelId = useId();
	return (
		<SelectPrimitive.Item
			// Name the row by its label alone, so the description is not read twice.
			aria-labelledby={labelId}
			{...props}
			className={cx("ui-overlay__item", "ui-select__item", className)}
			aria-describedby={
				cx(describedBy, description !== undefined && descriptionId) || undefined
			}
		>
			<SelectPrimitive.ItemText id={labelId}>
				{children}
			</SelectPrimitive.ItemText>
			{description !== undefined && (
				<span id={descriptionId} className="ui-select__item-description">
					{description}
				</span>
			)}
		</SelectPrimitive.Item>
	);
}
