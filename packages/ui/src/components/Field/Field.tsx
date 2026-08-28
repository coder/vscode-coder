import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import "./Field.css";

export type LabelProps = ComponentProps<"label">;

export function Label({ className, ...props }: LabelProps): React.JSX.Element {
	return <label {...props} className={cx("ui-label", className)} />;
}

export interface FieldProps extends ComponentProps<"div"> {
	description?: ReactNode;
	error?: ReactNode;
	htmlFor?: string;
	label?: ReactNode;
}

/* Lays out a labelled control like a settings-editor entry: semibold label,
   control, then muted description or error text. */
export function Field({
	label,
	htmlFor,
	description,
	error,
	className,
	children,
	...props
}: FieldProps): React.JSX.Element {
	return (
		<div {...props} className={cx("ui-field", className)}>
			{label !== undefined && <Label htmlFor={htmlFor}>{label}</Label>}
			{children}
			{description !== undefined && (
				<div className="ui-field__description">{description}</div>
			)}
			{error !== undefined && <div className="ui-field__error">{error}</div>}
		</div>
	);
}
