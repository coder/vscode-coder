import { type TreeNode } from "@repo/ui";

import { StatusDot, statusTone } from "./StatusDot";

import type { WorkspaceAgent } from "@repo/shared";

export function appStatusNodes(agent: WorkspaceAgent): readonly TreeNode[] {
	return agent.apps.flatMap((app) =>
		app.statuses.map((status) => ({
			id: `app-status:${status.id}`,
			textValue: `${app.display_name || app.slug}: ${status.message || status.state}`,
			label: (
				<AppStatusRow
					name={app.display_name || app.slug}
					message={status.message || status.state}
					status={status.state}
				/>
			),
		})),
	);
}

export function AppStatusRow({
	name,
	message,
	status,
}: {
	name: string;
	message: string;
	status: string;
}) {
	return (
		<span className="workspace-label">
			<StatusDot status={status} tone={statusTone(status)} />
			<span className="workspace-name">
				{name}: {message}
			</span>
		</span>
	);
}
