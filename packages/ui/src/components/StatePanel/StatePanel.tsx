import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import "../control.css";
import { Icon } from "../Icon/Icon";

import "./StatePanel.css";

import type { CodiconName } from "#codicons";

export interface StatePanelProps extends Omit<ComponentProps<"div">, "title"> {
	action?: ReactNode;
	description?: ReactNode;
	icon: CodiconName;
	title: ReactNode;
}

/** Internal skeleton shared by EmptyState and ErrorState; not part of the public API. */
export function StatePanel({
	action,
	description,
	icon,
	title,
	className,
	...props
}: StatePanelProps): React.JSX.Element {
	return (
		<div {...props} className={cx("ui-state-panel", className)}>
			<Icon name={icon} className="ui-state-panel__icon" />
			<h2 className="ui-state-panel__title">{title}</h2>
			{description ? (
				<div className="ui-state-panel__description">{description}</div>
			) : null}
			{action ? <div className="ui-state-panel__action">{action}</div> : null}
		</div>
	);
}
