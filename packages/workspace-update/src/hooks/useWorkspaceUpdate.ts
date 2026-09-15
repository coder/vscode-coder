import {
	buildApiHook,
	WorkspaceUpdateApi,
	type WorkspaceUpdateState,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import { useEffect, useState } from "react";

/** Subscribes to the extension-owned update session and requests its initial state. */
export function useWorkspaceUpdate() {
	const api = buildApiHook(WorkspaceUpdateApi, useIpc());
	const [state, setState] = useState<WorkspaceUpdateState | undefined>();

	useEffect(() => {
		const unsubscribe = api.onStateChanged(setState);
		api.ready();
		return unsubscribe;
	}, []);

	return { api, state };
}
