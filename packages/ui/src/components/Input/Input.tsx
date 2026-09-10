import { type ComponentProps } from "react";

import { cx } from "#cx";

import "../control.css";
import "../text-control.css";

import "./Input.css";

/** `children` render after the control as trailing in-field content, such
    as the reveal toggle in `PasswordInput`. */
export interface InputProps extends Omit<
	ComponentProps<"input">,
	"onChange" | "value"
> {
	onChange: (value: string) => void;
	value: string;
}

export function Input({
	value,
	onChange,
	className,
	style,
	children,
	...props
}: InputProps): React.JSX.Element {
	return (
		<div
			className={cx("ui-control", "ui-text-control", "ui-input", className)}
			style={style}
		>
			<input
				{...props}
				value={value}
				onChange={(event) => onChange(event.currentTarget.value)}
				className="ui-text-control__control ui-input__control"
			/>
			{children}
		</div>
	);
}
