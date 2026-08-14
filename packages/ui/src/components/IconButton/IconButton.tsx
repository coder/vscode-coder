import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import "../control.css";
import { Icon } from "../Icon/Icon";
import { Tooltip, TooltipScope } from "../Tooltip/Tooltip";

import "./IconButton.css";

import type { CodiconName } from "#codicons";

export interface IconButtonProps extends Omit<
	ComponentProps<"button">,
	"aria-label" | "children"
> {
	icon: CodiconName;
	label: string;
	/** Hover content; defaults to the label, `null` opts out. */
	tooltip?: ReactNode;
}

/* Hints through the hover widget, never the browser title box. */
export function IconButton({
	icon,
	label,
	tooltip = label,
	className,
	type = "button",
	...props
}: IconButtonProps): React.JSX.Element {
	const button = (
		<button
			{...props}
			type={type}
			aria-label={label}
			className={cx("ui-control", "ui-icon-button", className)}
		>
			<Icon name={icon} />
		</button>
	);
	if (!tooltip) return button;
	return (
		<TooltipScope>
			<Tooltip content={tooltip}>{button}</Tooltip>
		</TooltipScope>
	);
}
