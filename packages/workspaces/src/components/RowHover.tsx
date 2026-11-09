import { Fragment } from "react";

export function RowHover({
	title,
	details,
}: {
	title: string;
	details: ReadonlyArray<readonly [label: string, value: string]>;
}) {
	return (
		<div className="workspace-hover">
			<div className="workspace-hover__title">{title}</div>
			<dl className="workspace-hover__details">
				{details.map(([label, value]) => (
					<Fragment key={label}>
						<dt>{label}</dt>
						<dd>{value}</dd>
					</Fragment>
				))}
			</dl>
		</div>
	);
}
