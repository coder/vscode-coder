import { Icon } from "@repo/ui";

type StatusTone = "running" | "pending" | "error" | "stopped";

export function formatStatus(status: string): string {
	const words = status.replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusDot({ status }: { status: string }) {
	return (
		<Icon
			name="circle-filled"
			aria-label={formatStatus(status)}
			className={`workspace-status workspace-status--${statusTone(status)}`}
		/>
	);
}

function statusTone(status: string): StatusTone {
	switch (status) {
		case "running":
		case "connected":
		case "complete":
			return "running";
		case "pending":
		case "working":
		case "connecting":
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
