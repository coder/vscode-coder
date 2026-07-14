import { type HTMLAttributes, type ReactNode } from "react";

import "../control.css";
import { Icon } from "../Icon/Icon";
import "../StatePanel/StatePanel.css";

export interface ErrorStateProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"role" | "title"
> {
	action?: ReactNode;
	description?: ReactNode;
	onRetry?: () => void;
	retryLabel?: string;
	title?: ReactNode;
}

export function ErrorState({
	action,
	description,
	onRetry,
	retryLabel = "Try again",
	title = "Something went wrong",
	className,
	...props
}: ErrorStateProps): React.JSX.Element {
	return (
		<div
			{...props}
			className={["ui-state-panel", "ui-state-panel--error", className]
				.filter(Boolean)
				.join(" ")}
			role="alert"
		>
			<Icon name="error" className="ui-state-panel__icon" />
			<h2 className="ui-state-panel__title">{title}</h2>
			{description ? (
				<div className="ui-state-panel__description">{description}</div>
			) : null}
			{action || onRetry ? (
				<div className="ui-state-panel__action">
					{action ?? (
						<button type="button" onClick={onRetry}>
							{retryLabel}
						</button>
					)}
				</div>
			) : null}
		</div>
	);
}
