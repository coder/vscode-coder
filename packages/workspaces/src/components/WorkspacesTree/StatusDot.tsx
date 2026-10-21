import { Icon } from "@repo/ui";

import { formatStatus, statusTone, type RowStatus } from "./status";

export function StatusDot({ status }: { status: RowStatus }) {
	return (
		<Icon
			name="circle-filled"
			aria-label={formatStatus(status)}
			className={`workspace-status workspace-status--${statusTone(status)}`}
		/>
	);
}
