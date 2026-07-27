import { type ComponentProps } from "react";

import { cx } from "#cx";

import "./ProgressBar.css";

export interface ProgressBarProps extends Omit<
	ComponentProps<"div">,
	| "aria-label"
	| "aria-valuemax"
	| "aria-valuemin"
	| "aria-valuenow"
	| "children"
	| "role"
> {
	label?: string;
	max?: number;
	value?: number;
}

export function ProgressBar({
	label = "Progress",
	max = 100,
	value,
	className,
	...props
}: ProgressBarProps): React.JSX.Element {
	const safeMax = max > 0 ? max : 100;
	const safeValue =
		value === undefined ? undefined : Math.min(Math.max(value, 0), safeMax);
	const indeterminate = safeValue === undefined;

	return (
		<div
			{...props}
			className={cx(
				"ui-progress-bar",
				indeterminate && "ui-progress-bar--indeterminate",
				className,
			)}
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={safeMax}
			aria-valuenow={safeValue}
		>
			<span
				className="ui-progress-bar__indicator"
				style={
					safeValue === undefined
						? undefined
						: { width: `${(safeValue / safeMax) * 100}%` }
				}
			/>
		</div>
	);
}
