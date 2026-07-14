import { type HTMLAttributes, type ReactNode } from "react";

import "../control.css";
import { Icon } from "../Icon/Icon";

import "./StatusPill.css";

import type { CodiconName } from "../../codicons";

export type StatusPillTone =
	"neutral" | "info" | "success" | "warning" | "danger";

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
	icon?: CodiconName;
	iconLabel?: string;
	tone?: StatusPillTone;
	children: ReactNode;
}

export function StatusPill({
	icon,
	iconLabel,
	tone = "neutral",
	className,
	children,
	...props
}: StatusPillProps): React.JSX.Element {
	return (
		<span
			{...props}
			className={[
				"ui-control",
				"ui-status-pill",
				`ui-status-pill--${tone}`,
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			{icon ? <Icon name={icon} aria-label={iconLabel} /> : null}
			{children}
		</span>
	);
}
