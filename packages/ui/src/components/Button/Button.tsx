import { type ComponentProps } from "react";

import { cx } from "#cx";

import "../control.css";

import "./Button.css";

export interface ButtonProps extends ComponentProps<"button"> {
	variant?: "primary" | "secondary";
}

/** Text button matching VS Code's monaco-text-button. */
export function Button({
	variant = "primary",
	className,
	type = "button",
	...props
}: ButtonProps): React.JSX.Element {
	return (
		<button
			{...props}
			type={type}
			className={cx(
				"ui-control",
				"ui-button",
				variant === "secondary" && "ui-button--secondary",
				className,
			)}
		/>
	);
}
