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

export interface BannerAction {
	readonly label: string;
	readonly onClick: () => void;
}

export interface BannerProps extends Omit<ComponentProps<"div">, "role"> {
	severity?: BannerSeverity;
	/** Underlined links that follow the message, like VS Code's banner. */
	actions?: readonly BannerAction[];
	children: ReactNode;
}

/** Errors are announced assertively; info and warnings politely. */
export function Banner({
	severity = "info",
	actions = [],
	children,
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
			<div className="ui-banner__message">
				{children}
				{actions.map(({ label, onClick }) => (
					<button
						key={label}
						type="button"
						className="ui-banner__action"
						onClick={onClick}
					>
						{label}
					</button>
				))}
			</div>
		</div>
	);
}
