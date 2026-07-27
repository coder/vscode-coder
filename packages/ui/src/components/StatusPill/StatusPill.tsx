import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import "../control.css";
import { Icon } from "../Icon/Icon";

import "./StatusPill.css";

import type { CodiconName } from "#codicons";

export type StatusPillTone =
	"neutral" | "info" | "success" | "warning" | "danger";

export interface StatusPillProps extends ComponentProps<"span"> {
	icon?: CodiconName;
	tone?: StatusPillTone;
	children: ReactNode;
}

export function StatusPill({
	icon,
	tone = "neutral",
	className,
	children,
	...props
}: StatusPillProps): React.JSX.Element {
	return (
		<span
			{...props}
			className={cx(
				"ui-control",
				"ui-status-pill",
				`ui-status-pill--${tone}`,
				className,
			)}
		>
			{icon ? <Icon name={icon} /> : null}
			{children}
		</span>
	);
}
