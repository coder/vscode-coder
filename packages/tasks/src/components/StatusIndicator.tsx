import type { TaskState, TaskStatus, WorkspaceStatus } from "@repo/shared";

interface StatusInfo {
	className: string;
	title: string;
}

const STATUS_MAP: Record<string, StatusInfo> = {
	error: { className: "error", title: "Error" },
	initializing: { className: "initializing", title: "Initializing" },
	running: { className: "running", title: "Running" },
	ready: { className: "ready", title: "Ready" },
	paused: { className: "paused", title: "Paused" },
	unknown: { className: "unknown", title: "Unknown" },
};

function getStatusKey(
	status: TaskStatus,
	state?: TaskState | null,
	workspaceStatus?: WorkspaceStatus | null,
): string {
	if (
		state === "failed" ||
		status === "error" ||
		workspaceStatus === "failed"
	) {
		return "error";
	}

	if (
		status === "initializing" ||
		status === "pending" ||
		workspaceStatus === "starting" ||
		workspaceStatus === "pending"
	) {
		return "initializing";
	}

	if (workspaceStatus === "running") {
		if (state === "working") return "running";
		if (state === "complete" || state === "idle") return "ready";
		return "running";
	}

	if (
		workspaceStatus === "stopped" ||
		workspaceStatus === "stopping" ||
		workspaceStatus === "canceled"
	) {
		return "paused";
	}

	if (state === "complete" || state === "idle") return "ready";
	if (state === "working") return "running";
	if (status === "active") return "running";
	if (status === "paused") return "paused";

	return "unknown";
}

interface StatusIndicatorProps {
	status: TaskStatus;
	state?: TaskState | null;
	workspaceStatus?: WorkspaceStatus | null;
}

export function StatusIndicator({
	status,
	state,
	workspaceStatus,
}: StatusIndicatorProps) {
	const key = getStatusKey(status, state, workspaceStatus);
	const { className, title } = STATUS_MAP[key];

	return <span className={`status-dot ${className}`} title={title} />;
}
