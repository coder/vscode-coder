import {
	buildApiHook,
	WorkspacesApi,
	type ApiHook,
	type WorkspacesState,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import { replaceEqualDeep } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export type WorkspacesApiClient = ApiHook<typeof WorkspacesApi>;

/**
 * The state the extension pushes, and a stable set of commands to send back.
 * The state is undefined until the extension answers `ready`. Parts of a push
 * equal to the last one keep their identity, so unchanged rows stay memoized.
 */
export function useWorkspaces(): {
	state: WorkspacesState | undefined;
	api: WorkspacesApiClient;
} {
	const ipc = useIpc();
	const [api] = useState(() => buildApiHook(WorkspacesApi, ipc));
	const [state, setState] = useState<WorkspacesState | undefined>();

	useEffect(() => {
		const unsubscribe = api.onStateChanged((next) =>
			setState((previous) => replaceEqualDeep(previous, next)),
		);
		api.ready();
		return unsubscribe;
	}, [api]);

	return { state, api };
}
