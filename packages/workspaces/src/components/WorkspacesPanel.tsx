import {
	Banner,
	Button,
	EmptyState,
	ErrorState,
	LoadingState,
	ProgressBar,
	TooltipProvider,
} from "@repo/ui";

import { FilterBar } from "./FilterBar";
import { RelativeTime } from "./RelativeTime";
import "./WorkspacesPanel.css";
import { WorkspacesTree } from "./WorkspacesTree/WorkspacesTree";

import type { WorkspacesState } from "@repo/shared";
import type { ReactNode } from "react";

import type { WorkspacesApiClient } from "../hooks/useWorkspaces";

export function WorkspacesPanel({
	state,
	api,
}: {
	state: WorkspacesState | undefined;
	api: WorkspacesApiClient;
}) {
	if (state && !state.capabilities.authenticated) {
		return (
			<EmptyState
				title="Welcome to Coder"
				description="Coder is a platform that provisions remote development environments."
				action={<Button onClick={() => api.login()}>Login</Button>}
			/>
		);
	}

	const workspaces = state?.workspaces ?? [];
	const listedAtMs = state?.listedAtMs ?? null;
	const loading = !state || state.status.kind === "loading";
	const failed = state?.status.kind === "failed" ? state.status : undefined;
	const hasWorkspaces = workspaces.length > 0;
	let placeholder: ReactNode;
	if (hasWorkspaces) {
		placeholder = null;
	} else if (loading) {
		placeholder = <LoadingState label="Loading workspaces" />;
	} else if (failed) {
		placeholder = (
			<ErrorState
				title="Could not load workspaces"
				description={failed.error}
				onRetry={() => api.refresh()}
			/>
		);
	} else {
		placeholder = (
			<EmptyState
				title="No workspaces"
				description="No workspaces match this filter."
			/>
		);
	}

	return (
		<TooltipProvider>
			<section className="workspaces-panel" aria-label="Workspaces">
				{state && (
					<FilterBar
						filter={state.filter}
						filters={state.capabilities.filters}
						listedAtMs={failed ? null : listedAtMs}
						onFilterChange={(filter) => api.setFilter({ filter })}
					/>
				)}
				{failed && hasWorkspaces && (
					<Banner
						severity="warning"
						className="workspaces-stale"
						actions={[{ label: "Retry", onClick: () => api.refresh() }]}
					>
						Couldn't refresh.
						{listedAtMs !== null && (
							<>
								{" Showing results from "}
								<RelativeTime timestamp={listedAtMs} />.
							</>
						)}
						<span className="workspaces-stale__error"> {failed.error}</span>
					</Banner>
				)}
				{loading && hasWorkspaces && (
					<ProgressBar
						className="workspaces-refresh-progress"
						label="Refreshing workspaces"
					/>
				)}
				{placeholder}
				<WorkspacesTree
					workspaces={workspaces}
					metadata={state?.metadata ?? {}}
					chatWorkspaceIds={state?.chatWorkspaceIds ?? []}
					showOwner={state?.filter !== "mine"}
					api={api}
				/>
			</section>
		</TooltipProvider>
	);
}
