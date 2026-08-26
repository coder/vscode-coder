import {
	buildApiHook,
	WorkspacesApi,
	type WorkspacesUpdate,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";
import { useEffect, useState } from "react";

/**
 * The state the extension pushes, and the commands to send back. State fields
 * are undefined until their first push, which `ready` asks for.
 */
export function useWorkspaces() {
	const api = buildApiHook(WorkspacesApi, useIpc());
	const [state, setState] = useState<WorkspacesUpdate>({});

	useEffect(() => {
		const unsubscribe = api.onStateUpdated((update) =>
			setState((previous) => ({ ...previous, ...update })),
		);
		api.ready();
		return unsubscribe;
	}, []);

	return { state, api };
}
