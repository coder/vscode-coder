import { type ComponentProps } from "react";

import { cx } from "#cx";

import "../control.css";
import { Icon } from "../Icon/Icon";

import "./IconButton.css";

import type { CodiconName } from "#codicons";

export interface IconButtonProps extends Omit<
	ComponentProps<"button">,
	"aria-label" | "children"
> {
	icon: CodiconName;
	label: string;
}

/* No default title: native toolbar buttons hint with the styled hover
   widget, not the browser box. Wrap in Tooltip for that. */
export function IconButton({
	icon,
	label,
	className,
	type = "button",
	...props
}: IconButtonProps): React.JSX.Element {
	return (
		<button
			{...props}
			type={type}
			aria-label={label}
			className={cx("ui-control", "ui-icon-button", className)}
		>
			<Icon name={icon} />
		</button>
	);
}
