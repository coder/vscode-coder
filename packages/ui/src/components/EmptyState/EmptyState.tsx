import { type HTMLAttributes, type ReactNode } from "react";

import { StatePanel } from "../StatePanel/StatePanel";

import type { CodiconName } from "#codicons";

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
	icon = "inbox",
	...props
}: EmptyStateProps): React.JSX.Element {
	return <StatePanel {...props} icon={icon} />;
}
