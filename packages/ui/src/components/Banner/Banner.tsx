import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import { Icon } from "../Icon/Icon";

import "./Banner.css";

import type { CodiconName } from "#codicons";

type BannerSeverity = "info" | "warning" | "error";

const ICONS: Readonly<Record<BannerSeverity, CodiconName>> = {
	info: "info",
	warning: "alert",
	error: "error",
};

export interface BannerProps extends Omit<ComponentProps<"div">, "role"> {
	severity?: BannerSeverity;
	children: ReactNode;
	actionLabel?: string;
	onAction?: () => void;
}

export function Banner({
	severity = "info",
	children,
	actionLabel,
	onAction,
	className,
	...props
}: BannerProps): React.JSX.Element {
	return (
		<div
			{...props}
			role={severity === "error" ? "alert" : "status"}
			className={cx("ui-banner", `ui-banner--${severity}`, className)}
		>
			<Icon name={ICONS[severity]} className="ui-banner__icon" />
			<div className="ui-banner__message">{children}</div>
			{actionLabel && onAction ? (
				<button type="button" className="ui-banner__action" onClick={onAction}>
					{actionLabel}
				</button>
			) : null}
		</div>
	);
}
