import {
	buildApiHook,
	WorkspacesApi,
	type WorkspacesState,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import { useEffect, useState } from "react";

/**
 * The state the extension pushes, and the commands to send back. The state is
 * undefined until the extension answers `ready`.
 */
export function useWorkspaces() {
	const api = buildApiHook(WorkspacesApi, useIpc());
	const [state, setState] = useState<WorkspacesState | undefined>();

	useEffect(() => {
		const unsubscribe = api.onStateChanged(setState);
		api.ready();
		return unsubscribe;
	}, []);

	return { state, api };
}
