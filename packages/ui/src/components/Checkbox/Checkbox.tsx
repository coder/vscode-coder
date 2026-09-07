import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import { Icon } from "../Icon/Icon";

import "./Checkbox.css";

export interface CheckboxProps extends Omit<
	ComponentProps<"input">,
	"checked" | "children" | "onChange" | "type"
> {
	checked: boolean;
	children?: ReactNode;
	onChange: (checked: boolean) => void;
}

/* The native input supplies state, focus, and semantics; the box paints
   VS Code's checkbox geometry and shows a codicon check. */
export function Checkbox({
	checked,
	onChange,
	className,
	style,
	disabled,
	children,
	...props
}: CheckboxProps): React.JSX.Element {
	return (
		<label
			className={cx(
				"ui-checkbox",
				disabled && "ui-checkbox--disabled",
				className,
			)}
			style={style}
		>
			<input
				{...props}
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.currentTarget.checked)}
				disabled={disabled}
				className="ui-checkbox__input"
			/>
			<span className="ui-checkbox__box" aria-hidden="true">
				<Icon name="check" />
			</span>
			{children}
		</label>
	);
}
