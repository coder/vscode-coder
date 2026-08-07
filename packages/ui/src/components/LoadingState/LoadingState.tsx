import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import { Spinner } from "../Spinner/Spinner";
import "../StatePanel/StatePanel.css";

export interface LoadingStateProps extends Omit<
	ComponentProps<"div">,
	"title"
> {
	description?: ReactNode;
	label?: string;
	title?: ReactNode;
}

/** Loading twin of the state panels, with the spinner in place of the icon. */
export function LoadingState({
	description,
	label,
	title,
	className,
	...props
}: LoadingStateProps): React.JSX.Element {
	return (
		<div {...props} className={cx("ui-state-panel", className)}>
			<Spinner size="large" label={label} className="ui-state-panel__spinner" />
			{title ? <h2 className="ui-state-panel__title">{title}</h2> : null}
			{description ? (
				<div className="ui-state-panel__description">{description}</div>
			) : null}
		</div>
	);
}
