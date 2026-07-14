import { type HTMLAttributes, type ReactNode } from "react";

import "./control.css";
import { Icon } from "./Icon";
import "./StatePanel.css";

import type { CodiconName } from "../codicons";

export interface EmptyStateProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"title"
> {
	action?: ReactNode;
	description?: ReactNode;
	icon?: CodiconName;
	title: ReactNode;
}

export function EmptyState({
	action,
	description,
	icon = "inbox",
	title,
	className,
	...props
}: EmptyStateProps): React.JSX.Element {
	return (
		<div
			{...props}
			className={["ui-state-panel", className].filter(Boolean).join(" ")}
		>
			<Icon name={icon} className="ui-state-panel__icon" />
			<h2 className="ui-state-panel__title">{title}</h2>
			{description ? (
				<div className="ui-state-panel__description">{description}</div>
			) : null}
			{action ? <div className="ui-state-panel__action">{action}</div> : null}
		</div>
	);
}
