import { type ComponentProps } from "react";

import { cx } from "#cx";

import "../text-control.css";

import "./Textarea.css";

export interface TextareaProps extends Omit<
	ComponentProps<"textarea">,
	"onChange" | "value"
> {
	onChange: (value: string) => void;
	value: string;
}

export function Textarea({
	value,
	onChange,
	className,
	...props
}: TextareaProps): React.JSX.Element {
	return (
		<textarea
			{...props}
			value={value}
			onChange={(event) => onChange(event.currentTarget.value)}
			className={cx("ui-text-control", "ui-textarea", className)}
		/>
	);
}
