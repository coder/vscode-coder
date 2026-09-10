import { isAxiosError } from "axios";

import { isOwner } from "../api/api-helper";

import type { WorkspaceFilter } from "@repo/shared";

import type { SessionData, SignedInSession } from "../deployment/sessionStore";

/** How one set of workspaces is listed and shown, and who may select it. */
export interface WorkspaceFilterConfig {
	readonly requiresOwner: boolean;
	/** How often to list again while showing. Absent when listed on demand. */
	readonly pollIntervalMs?: number;
	/** Whether listed workspaces can belong to other users. */
	readonly showOwner: boolean;
	/** Whether the tree watches the metadata of every listed agent. */
	readonly showMetadata: boolean;
	readonly getQuery: (session: SignedInSession) => string;
}

/** Keys are in display order. */
export const WORKSPACE_FILTERS: Readonly<
	Record<WorkspaceFilter, WorkspaceFilterConfig>
> = {
	mine: {
		requiresOwner: false,
		pollIntervalMs: 5_000,
		showOwner: false,
		showMetadata: true,
		getQuery: () => "owner:me",
	},
	shared: {
		requiresOwner: false,
		showOwner: true,
		showMetadata: false,
		// Excludes workspaces the user owns and shared with others.
		// Requires Coder 2.27.0+.
		getQuery: (session) => `shared_with_user:${session.user.id}`,
	},
	all: {
		requiresOwner: true,
		showOwner: true,
		showMetadata: false,
		getQuery: () => "",
	},
};

export const DEFAULT_WORKSPACE_FILTER: WorkspaceFilter = "mine";

/** The filters `session` may select, minus the ones `unsupported` lists. */
export function availableFilters(
	session: SessionData,
	unsupported: ReadonlySet<WorkspaceFilter>,
): readonly WorkspaceFilter[] {
	if (session.kind !== "signedIn") {
		return [];
	}
	const owner = isOwner(session.user);
	return (Object.keys(WORKSPACE_FILTERS) as WorkspaceFilter[]).filter(
		(filter) =>
			!unsupported.has(filter) &&
			(owner || !WORKSPACE_FILTERS[filter].requiresOwner),
	);
}

/** True when the deployment cannot run a filter's query. */
export function isQueryRejected(error: unknown): boolean {
	return isAxiosError(error) && error.response?.status === 400;
}
