import type { ReactNode } from "react";

export function RowLabel({
	icon,
	name,
	children,
}: {
	icon: ReactNode;
	name: string;
	children?: ReactNode;
}) {
	return (
		<span className="workspace-label">
			{icon}
			<span className="workspace-label__text">{name}</span>
			{children}
		</span>
	);
}
