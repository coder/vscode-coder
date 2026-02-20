import { TasksApi, buildApiHook } from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";

export function useTasksApi() {
	return buildApiHook(TasksApi, useIpc());
}
