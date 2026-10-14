import { Tooltip } from "@repo/ui";

type StatusTone = "running" | "pending" | "error" | "stopped";

export function StatusDot({
	status,
	tone,
}: {
	status: string;
	tone: StatusTone;
}) {
	return (
		<Tooltip content={status}>
			<span
				role="img"
				aria-label={status}
				className={`workspace-status workspace-status--${tone}`}
			/>
		</Tooltip>
	);
}

export function statusTone(status: string): StatusTone {
	switch (status) {
		case "running":
		case "connected":
		case "healthy":
		case "complete":
			return "running";
		case "pending":
		case "working":
		case "connecting":
		case "initializing":
		case "starting":
		case "stopping":
		case "deleting":
		case "canceling":
		case "created":
		case "shutting_down":
			return "pending";
		case "failed":
		case "failure":
		case "unhealthy":
		case "timeout":
		case "start_error":
		case "start_timeout":
		case "shutdown_error":
		case "shutdown_timeout":
			return "error";
		default:
			return "stopped";
	}
}
