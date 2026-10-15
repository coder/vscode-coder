import { Spinner, type TreeNode } from "@repo/ui";

import type { AgentMetadataState } from "@repo/shared";

export function agentMetadataNodes(
	agentId: string,
	state: AgentMetadataState | undefined,
): readonly TreeNode[] {
	const prefix = `metadata:${agentId}`;
	if (!state || state.kind === "pending") {
		return [
			{
				id: `${prefix}:loading`,
				textValue: "Loading metadata",
				label: (
					<span className="workspace-label">
						<Spinner size="small" label="Loading metadata" />
						<span className="workspace-name">Loading metadata...</span>
					</span>
				),
			},
		];
	}
	if (state.kind === "failed") {
		return [{ id: `${prefix}:error`, label: state.error, icon: "error" }];
	}
	if (state.metadata.length === 0) {
		return [{ id: `${prefix}:empty`, label: "No metadata reported" }];
	}
	return state.metadata.map(({ description, result }) => {
		const name = description.display_name || description.key;
		const value = result.error || result.value || "Unknown";
		return {
			id: `${prefix}:${description.key}`,
			textValue: `${name}: ${value}`,
			label: (
				<AgentMetadataList
					name={name}
					value={value}
					error={Boolean(result.error)}
				/>
			),
			tooltip: (
				<>
					{name}: {value}
					<br />
					Collected at {result.collected_at}
				</>
			),
		};
	});
}

export function AgentMetadataList({
	name,
	value,
	error = false,
}: {
	name: string;
	value: string;
	error?: boolean;
}) {
	return (
		<span
			className={`workspace-metadata${error ? " workspace-metadata--error" : ""}`}
		>
			<span>{name}:</span>
			<span>{value}</span>
		</span>
	);
}
