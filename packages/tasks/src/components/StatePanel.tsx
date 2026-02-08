import type { ReactNode } from "react";

interface StatePanelProps {
	className?: string;
	icon?: ReactNode;
	title?: string;
	description?: string;
	action?: ReactNode;
}

export function StatePanel({
	className,
	icon,
	title,
	description,
	action,
}: StatePanelProps) {
	return (
		<div className={["centered-state", className].filter(Boolean).join(" ")}>
			{icon}
			{title && <p className="centered-state-title">{title}</p>}
			{description && (
				<p className="centered-state-description">{description}</p>
			)}
			{action}
		</div>
	);
}
