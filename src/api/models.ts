import {
	type User,
	type Workspace,
	type WorkspaceAgent,
	type WorkspaceResource,
	type WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

/** True when the user holds the deployment-wide owner role. */
export function isOwner(user: User | undefined): boolean {
	return user?.roles.some((role) => role.name === "owner") ?? false;
}

/**
 * Create workspace owner/name identifier
 */
export function createWorkspaceIdentifier(workspace: Workspace): string {
	return `${workspace.owner_name}/${workspace.name}`;
}

const WORKSPACE_STATUS_LABEL: Readonly<Record<WorkspaceStatus, string>> = {
	canceled: "Canceled",
	canceling: "Canceling",
	deleted: "Deleted",
	deleting: "Deleting",
	failed: "Failed",
	pending: "Pending",
	running: "Running",
	starting: "Starting",
	stopped: "Stopped",
	stopping: "Stopping",
};

export function workspaceStatusLabel(status: WorkspaceStatus): string {
	return (
		WORKSPACE_STATUS_LABEL[status] ??
		status.charAt(0).toUpperCase() + status.slice(1)
	);
}

export function extractAllAgents(
	workspaces: readonly Workspace[],
): WorkspaceAgent[] {
	return workspaces.reduce((acc, workspace) => {
		return acc.concat(extractAgents(workspace.latest_build.resources));
	}, [] as WorkspaceAgent[]);
}

export function extractAgents(
	resources: readonly WorkspaceResource[],
): WorkspaceAgent[] {
	return resources.reduce((acc, resource) => {
		return acc.concat(resource.agents ?? []);
	}, [] as WorkspaceAgent[]);
}
