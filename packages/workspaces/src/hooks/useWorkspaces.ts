import {
	buildApiHook,
	WorkspacesApi,
	type WorkspacesState,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import { replaceEqualDeep } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Pushed state and a stable command API. Unchanged JSON subtrees retain their
 * identity for consumer memoization; state is undefined until `ready` is answered.
 */
export function useWorkspaces() {
	const ipc = useIpc();
	const [api] = useState(() => buildApiHook(WorkspacesApi, ipc));
	const [state, setState] = useState<WorkspacesState | undefined>();

	useEffect(() => {
		const unsubscribe = api.onStateChanged((next) => {
			setState((previous) => replaceEqualDeep(previous, next));
		});
		api.ready();
		return unsubscribe;
	}, [api]);

	return { state, api };
}
