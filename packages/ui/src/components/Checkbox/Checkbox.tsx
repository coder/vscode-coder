import { type ChangeEvent, type ComponentProps, type ReactNode } from "react";

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
	const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
		onChange(event.currentTarget.checked);
	};

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
				onChange={handleChange}
				disabled={disabled}
				className="ui-checkbox__input"
			/>
			<span className="ui-checkbox__box" aria-hidden="true">
				<Icon name="check" />
			</span>
			{children !== undefined && (
				<span className="ui-checkbox__label">{children}</span>
			)}
		</label>
	);
}
