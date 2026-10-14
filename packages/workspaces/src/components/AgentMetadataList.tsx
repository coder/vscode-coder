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
				label: <Spinner label="Loading metadata" />,
			},
		];
	}
	if (state.kind === "failed") {
		return [{ id: `${prefix}:error`, label: state.error, icon: "error" }];
	}
	if (state.metadata.length === 0) {
		return [{ id: `${prefix}:empty`, label: "No metadata reported" }];
	}
	return state.metadata.map(({ description, result }) => ({
		id: `${prefix}:${description.key}`,
		textValue: `${description.display_name || description.key}: ${result.error || result.value || "Unknown"}`,
		label: (
			<AgentMetadataList
				name={description.display_name || description.key}
				value={result.error || result.value || "Unknown"}
				error={Boolean(result.error)}
			/>
		),
		tooltip: `Collected at ${result.collected_at}${result.error ? `: ${result.error}` : ""}`,
	}));
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
