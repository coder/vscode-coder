import { type ComponentProps } from "react";

import { cx } from "#cx";

import "./ValidationMessage.css";

export type ValidationSeverity = "info" | "warning" | "error";

export interface ValidationMessageProps extends ComponentProps<"div"> {
	severity: ValidationSeverity;
}

/** VS Code's input box validation message. */
export function ValidationMessage({
	severity,
	className,
	...props
}: ValidationMessageProps): React.JSX.Element {
	return (
		<div
			{...props}
			className={cx(
				"ui-validation-message",
				`ui-validation-message--${severity}`,
				className,
			)}
		/>
	);
}
