import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import "./Field.css";

export type LabelProps = ComponentProps<"label">;

export function Label({ className, ...props }: LabelProps): React.JSX.Element {
	return <label {...props} className={cx("ui-label", className)} />;
}

export interface FieldProps extends ComponentProps<"div"> {
	description?: ReactNode;
	/** ID for the description; associate it with the control via aria-describedby. */
	descriptionId?: string;
	error?: ReactNode;
	/** ID for the error; the consumer owns aria-describedby and aria-invalid. */
	errorId?: string;
	htmlFor?: string;
	label?: ReactNode;
}

/* Lays out a labelled control like a settings-editor entry: semibold label,
   control, then muted description or error text. */
export function Field({
	label,
	htmlFor,
	description,
	descriptionId,
	error,
	errorId,
	className,
	children,
	...props
}: FieldProps): React.JSX.Element {
	return (
		<div {...props} className={cx("ui-field", className)}>
			{label !== undefined && <Label htmlFor={htmlFor}>{label}</Label>}
			{children}
			{description !== undefined && (
				<div id={descriptionId} className="ui-field__description">
					{description}
				</div>
			)}
			{error !== undefined && (
				<div id={errorId} className="ui-field__error">
					{error}
				</div>
			)}
		</div>
	);
}
