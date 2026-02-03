import { VscodeIcon } from "@vscode-elements/react-elements";

interface CollapsibleSectionProps {
	title: string;
	expanded: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}

export function CollapsibleSection({
	title,
	expanded,
	onToggle,
	children,
}: CollapsibleSectionProps) {
	return (
		<div className="collapsible-section">
			<button
				type="button"
				className="section-header"
				onClick={onToggle}
				aria-expanded={expanded}
			>
				<VscodeIcon name={expanded ? "chevron-down" : "chevron-right"} />
				<span className="section-title">{title}</span>
			</button>
			{expanded && <div className="section-content">{children}</div>}
		</div>
	);
}
