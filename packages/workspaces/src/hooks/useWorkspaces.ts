import {
	buildApiHook,
	WorkspacesApi,
	type WorkspacesState,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import { useEffect, useState } from "react";

/** `state` is undefined until the extension answers `ready`. */
export function useWorkspaces() {
	const ipc = useIpc();
	const [api] = useState(() => buildApiHook(WorkspacesApi, ipc));
	const [state, setState] = useState<WorkspacesState | undefined>();

	useEffect(() => {
		const unsubscribe = api.onStateChanged(setState);
		api.ready();
		return unsubscribe;
	}, [api]);

	return { state, api };
}
