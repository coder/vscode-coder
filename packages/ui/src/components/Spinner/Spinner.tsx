import { type HTMLAttributes } from "react";

import { cx } from "#cx";

import "./Spinner.css";

export interface SpinnerProps extends Omit<
	HTMLAttributes<HTMLSpanElement>,
	"aria-label" | "children" | "role"
> {
	label?: string;
	size?: "small" | "medium" | "large";
}

export function Spinner({
	label = "Loading",
	size = "medium",
	className,
	...props
}: SpinnerProps): React.JSX.Element {
	return (
		<span
			{...props}
			className={cx("ui-spinner", `ui-spinner--${size}`, className)}
			role="status"
			aria-label={label}
		/>
	);
}
