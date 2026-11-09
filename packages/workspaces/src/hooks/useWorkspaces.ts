import { buildApiHook, WorkspacesApi } from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { stateQuery } from "../config";

/**
 * `state` is undefined until the extension answers `ready`. Each push goes
 * through the query cache, which keeps unchanged parts by identity, so the
 * compiled rows of unchanged workspaces return their cached output.
 */
export function useWorkspaces() {
	const ipc = useIpc();
	const queryClient = useQueryClient();
	const [api] = useState(() => buildApiHook(WorkspacesApi, ipc));
	const { data: state } = useQuery(stateQuery);

	useEffect(() => {
		const unsubscribe = api.onStateChanged((next) =>
			queryClient.setQueryData(stateQuery.queryKey, next),
		);
		api.ready();
		return unsubscribe;
	}, [api, queryClient]);

	return { state, api };
}
