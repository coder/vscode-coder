import { type ComponentProps } from "react";

import { cx } from "#cx";

import "../control.css";
import { Icon } from "../Icon/Icon";

import "./Checkbox.css";

export interface CheckboxProps extends Omit<
	ComponentProps<"input">,
	"checked" | "onChange" | "type"
> {
	checked: boolean;
	onChange: (checked: boolean) => void;
}

/* The native input supplies state, focus, and semantics; the box paints
   VS Code's checkbox geometry and shows a codicon check. */
export function Checkbox({
	checked,
	onChange,
	className,
	style,
	children,
	...props
}: CheckboxProps): React.JSX.Element {
	return (
		<label className={cx("ui-checkbox", className)} style={style}>
			<input
				{...props}
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.currentTarget.checked)}
				className="ui-checkbox__input"
			/>
			<span className="ui-control ui-checkbox__box" aria-hidden="true">
				{checked && <Icon name="check" />}
			</span>
			{children}
		</label>
	);
}
