import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WorkspacesState } from "@repo/shared";

export const queryKeys = {
	state: ["workspaces", "state"],
} as const;

/** Pushed whole by the extension, never fetched. */
export const stateQuery = queryOptions<WorkspacesState>({
	queryKey: queryKeys.state,
	queryFn: skipToken,
});
