import { type HTMLAttributes } from "react";

import { cx } from "#cx";

import "./Icon.css";

import type { CodiconName } from "#codicons";

export interface IconProps extends Omit<
	HTMLAttributes<HTMLSpanElement>,
	"children"
> {
	name: CodiconName;
	spin?: boolean;
}

export function Icon({
	name,
	spin = false,
	className,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	...props
}: IconProps): React.JSX.Element {
	const isLabelled = Boolean(ariaLabel || ariaLabelledBy);
	const classes = cx(
		"ui-icon",
		"codicon",
		`codicon-${name}`,
		spin && "ui-icon--spin",
		className,
	);

	return (
		<span
			{...props}
			className={classes}
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			aria-hidden={isLabelled ? undefined : true}
			role={isLabelled ? "img" : undefined}
		/>
	);
}
