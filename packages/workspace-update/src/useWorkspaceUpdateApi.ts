import { buildApiHook, WorkspaceUpdateApi } from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";

export function useWorkspaceUpdateApi() {
	return buildApiHook(WorkspaceUpdateApi, useIpc());
}
