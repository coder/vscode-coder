import { opens, receives } from "./support/streams";
import {
	ssh,
	startOutdatedWithCli,
	updateInOneBuild,
} from "./support/workspaceActions";
import { currentAgentId } from "./support/workspaces";

import type { CoderApi } from "@/api/coderApi";

import type { Probe } from "./support/deployment";

type ApiMethod = keyof CoderApi;

/**
 * One probe per Coder API method the extension calls, keyed `method` or
 * `method (variant)`; `oauthScopeProbes.test.ts` checks the keys. Mutating
 * probes leave `own` running with no build in progress, so any order works.
 */
export const apiProbes = {
	getBuildInfo: ({ scoped }) => scoped.getBuildInfo(),
	getAuthenticatedUser: ({ scoped }) => scoped.getAuthenticatedUser(),
	getAppearance: ({ scoped }) => scoped.getAppearance(),
	getDeploymentSSHConfig: ({ scoped }) => scoped.getDeploymentSSHConfig(),
	getWorkspaces: async ({ scoped }) =>
		assertNonEmpty((await scoped.getWorkspaces({ q: "owner:me" })).workspaces),
	"getWorkspaces (shared)": async ({ scoped, own }) =>
		assertNonEmpty(
			(await scoped.getWorkspaces({ q: `shared_with_user:${own.owner_id}` }))
				.workspaces,
		),
	getWorkspace: ({ scoped, own }) => scoped.getWorkspace(own.id),
	getWorkspaceByOwnerAndName: ({ scoped, own }) =>
		scoped.getWorkspaceByOwnerAndName(own.owner_name, own.name),
	"getWorkspaceByOwnerAndName (shared)": ({ scoped, shared }) =>
		scoped.getWorkspaceByOwnerAndName(shared.owner_name, shared.name),
	getWorkspaceBuildByNumber: ({ scoped, own }) =>
		scoped.getWorkspaceBuildByNumber(own.owner_name, own.name, 1),
	getWorkspaceBuildParameters: async ({ scoped, own }) =>
		assertNonEmpty(
			await scoped.getWorkspaceBuildParameters(own.latest_build.id),
		),
	// Empty: the test agent never connects
	getWorkspaceAgentLogs: async ({ scoped, admin, own }) =>
		scoped.getWorkspaceAgentLogs(await currentAgentId(admin, own)),
	getTemplate: ({ scoped, own }) => scoped.getTemplate(own.template_id),
	getTemplateVersion: ({ scoped, own }) =>
		scoped.getTemplateVersion(own.template_active_version_id),
	getTemplateVersionResources: async ({ scoped, own }) =>
		assertNonEmpty(
			await scoped.getTemplateVersionResources(own.template_active_version_id),
		),
	getTemplateVersionRichParameters: async ({ scoped, own }) =>
		assertNonEmpty(
			await scoped.getTemplateVersionRichParameters(
				own.template_active_version_id,
			),
		),
	getTemplateVersionPresets: async ({ scoped, own }) =>
		assertNonEmpty(
			await scoped.getTemplateVersionPresets(own.template_active_version_id),
		),
	watchWorkspace: receives((api, { own }) => api.watchWorkspace(own)),
	watchAgentMetadata: receives(async (api, { admin, own }) =>
		api.watchAgentMetadata(await currentAgentId(admin, own)),
	),
	watchBuildLogsByBuildId: opens((api, { own }) =>
		api.watchBuildLogsByBuildId(own.latest_build.id, []),
	),
	watchWorkspaceAgentLogs: opens(async (api, { admin, own }) =>
		api.watchWorkspaceAgentLogs(await currentAgentId(admin, own), []),
	),
	watchInboxNotifications: opens((api) => api.watchInboxNotifications([], [])),
	"postWorkspaceBuild (update)": updateInOneBuild,
} satisfies Partial<Record<ApiMethod | `${ApiMethod} (${string})`, Probe>>;

/**
 * CLI requests the source scan can't find. Unprobed: `ping` and `speedtest`
 * dial like `ssh`, `netcheck` calls `/workspaceagents/connection`, which has
 * no RBAC check, and `support bundle` reads what other probes cover.
 */
export const cliProbes: Record<string, Probe> = {
	"coder ssh": (d) => ssh(d, d.own),
	"coder ssh (shared)": (d) => ssh(d, d.shared),
	"coder start": startOutdatedWithCli,
};

const TASKS_API =
	"Tasks API, only used on servers before 2.35, which ignore OAuth scopes";

/** Coder API methods the extension calls that need no probe, with the reason. */
export const unprobedMethods: Partial<Record<ApiMethod, string>> = {
	startWorkspace: TASKS_API,
	stopWorkspace: TASKS_API,
	createTask: TASKS_API,
	deleteTask: TASKS_API,
	getTask: TASKS_API,
	getTaskLogs: TASKS_API,
	getTasks: TASKS_API,
	getTemplates: TASKS_API,
	pauseTask: TASKS_API,
	resumeTask: TASKS_API,
	sendTaskInput: TASKS_API,
};

function assertNonEmpty(items: readonly unknown[] | null): void {
	if (!items?.length) {
		throw new Error(
			"Expected at least one item; the server omits rows the token cannot read, so an empty list usually means a missing scope",
		);
	}
}
