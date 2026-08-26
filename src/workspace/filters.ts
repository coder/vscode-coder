import { isOwner } from "../api/api-helper";

import type { WorkspaceFilter } from "@repo/shared";

import type { SessionData } from "../deployment/sessionStore";

type SignedInSession = Extract<SessionData, { kind: "signedIn" }>;

/** How one set of workspaces is listed, rendered, and who may select it. */
export interface WorkspaceFilterConfig {
	readonly showOwner: boolean;
	readonly showMetadata: boolean;
	readonly requiresOwner: boolean;
	/** Whether the panel keeps polling this filter, or fetches on demand. */
	readonly poll: boolean;
	readonly getQuery: (session: SignedInSession) => string;
}

export const WORKSPACE_FILTERS = {
	mine: {
		showOwner: false,
		showMetadata: true,
		requiresOwner: false,
		poll: true,
		getQuery: () => "owner:me",
	},
	shared: {
		showOwner: true,
		showMetadata: false,
		requiresOwner: false,
		poll: false,
		// Excludes workspaces the user owns and shared with others.
		// Requires Coder 2.27.0+.
		getQuery: (session) => `shared_with_user:${session.user.id}`,
	},
	all: {
		showOwner: true,
		showMetadata: false,
		requiresOwner: true,
		poll: false,
		getQuery: () => "",
	},
} as const satisfies Record<WorkspaceFilter, WorkspaceFilterConfig>;

export const DEFAULT_WORKSPACE_FILTER: WorkspaceFilter = "mine";

const FILTER_ORDER = Object.keys(WORKSPACE_FILTERS) as WorkspaceFilter[];

/** The filters `session` may select, minus the ones `unsupported` lists. */
export function availableFilters(
	session: SessionData,
	unsupported: ReadonlySet<WorkspaceFilter> = new Set(),
): WorkspaceFilter[] {
	if (session.kind !== "signedIn") {
		return [];
	}
	const owner = isOwner(session.user);
	return FILTER_ORDER.filter(
		(filter) =>
			!unsupported.has(filter) &&
			(owner || !WORKSPACE_FILTERS[filter].requiresOwner),
	);
}
