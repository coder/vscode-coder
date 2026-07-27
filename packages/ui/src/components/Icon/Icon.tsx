import { type ComponentProps } from "react";

import { cx } from "#cx";

import "./Icon.css";

import type { CodiconName } from "#codicons";

export interface IconProps extends Omit<ComponentProps<"span">, "children"> {
	name: CodiconName;
	spin?: boolean;
}

export function Icon({
	name,
	spin = false,
	className,
	...props
}: IconProps): React.JSX.Element {
	const isLabelled = Boolean(props["aria-label"] || props["aria-labelledby"]);
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
			aria-hidden={isLabelled ? undefined : true}
			role={isLabelled ? "img" : undefined}
		/>
	);
}
