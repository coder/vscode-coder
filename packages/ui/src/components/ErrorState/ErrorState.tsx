import { type ComponentProps, type ReactNode } from "react";

import { cx } from "#cx";

import { Button } from "../Button/Button";
import { StatePanel } from "../StatePanel/StatePanel";

export interface ErrorStateProps extends Omit<
	ComponentProps<"div">,
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
	onRetry,
	retryLabel = "Try again",
	title = "Something went wrong",
	className,
	...props
}: ErrorStateProps): React.JSX.Element {
	return (
		<StatePanel
			{...props}
			role="alert"
			icon="error"
			title={title}
			className={cx("ui-state-panel--error", className)}
			action={
				action ??
				(onRetry ? <Button onClick={onRetry}>{retryLabel}</Button> : undefined)
			}
		/>
	);
}
