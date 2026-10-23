export function MetadataRow({
	name,
	value,
	failed,
}: {
	name: string;
	value: string;
	failed: boolean;
}) {
	return (
		<span
			className={`workspace-metadata${failed ? " workspace-metadata--error" : ""}`}
		>
			<span>{name}:</span>
			<span className="workspace-metadata__value">{value}</span>
		</span>
	);
}
