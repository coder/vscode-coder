import type { WorkspaceConfiguration } from "vscode";

/** Whether all deployment notifications are disabled. */
export function areNotificationsDisabled(
	cfg: Pick<WorkspaceConfiguration, "get">,
): boolean {
	return cfg.get<boolean>("coder.disableNotifications", false);
}

/** Whether workspace update notifications are disabled (blanket or update-specific). */
export function areUpdateNotificationsDisabled(
	cfg: Pick<WorkspaceConfiguration, "get">,
): boolean {
	return (
		areNotificationsDisabled(cfg) ||
		cfg.get<boolean>("coder.disableUpdateNotifications", false)
	);
}
