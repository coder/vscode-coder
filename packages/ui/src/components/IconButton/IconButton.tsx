import { type ButtonHTMLAttributes } from "react";

import "../control.css";
import { Icon } from "../Icon/Icon";

import "./IconButton.css";

import type { CodiconName } from "../../codicons";

export interface IconButtonProps extends Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"aria-label" | "children"
> {
	icon: CodiconName;
	label: string;
}

export function IconButton({
	icon,
	label,
	className,
	title = label,
	type = "button",
	...props
}: IconButtonProps): React.JSX.Element {
	return (
		<button
			{...props}
			type={type}
			title={title}
			aria-label={label}
			className={["ui-control", "ui-icon-button", className]
				.filter(Boolean)
				.join(" ")}
		>
			<Icon name={icon} />
		</button>
	);
}
