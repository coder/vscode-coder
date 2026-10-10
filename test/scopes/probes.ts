import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import * as semver from "semver";
import WebSocket from "ws";

import { CoderApi } from "@/api/coderApi";
import { startWorkspace, updateWorkspace } from "@/api/workspace";
import { cliFeatureSet, serverFeatureSet } from "@/featureSet";
import { rawDataToString } from "@/websocket/oneWayWebSocket";

import { LogCollector, MockConfigurationProvider } from "../mocks/testHelpers";

import {
	awaitBuildSuccess,
	awaitFollowUpBuild,
	createRunningWorkspace,
	openSocket,
	promoteNewTemplateVersion,
	type Deployment,
} from "./deployment";

import type { Api } from "coder/site/src/api/api";
import type { Workspace } from "coder/site/src/api/typesGenerated";

import type { UnidirectionalStream } from "@/websocket/eventStreamConnection";

/** Calls the server with the scoped token and throws if it refuses. */
type Probe = (deployment: Deployment) => Promise<unknown>;

type OpenStream = (
	api: CoderApi,
	deployment: Deployment,
) => Promise<UnidirectionalStream<unknown>>;

type CliContext = Parameters<typeof startWorkspace>[0];

/**
 * Probes for the Coder API methods the extension calls, keyed `method` or
 * `method (variant)`; `scopeProbes.test.ts` checks the keys.
 */
export const probes: Record<string, Probe> = {
	getBuildInfo: ({ scoped }) => scoped.getBuildInfo(),
	getAuthenticatedUser: ({ scoped }) => scoped.getAuthenticatedUser(),
	getAppearance: ({ scoped }) => scoped.getAppearance(),
	getDeploymentSSHConfig: ({ scoped }) => scoped.getDeploymentSSHConfig(),
	getWorkspaces: async ({ scoped }) =>
		assertNonEmpty((await scoped.getWorkspaces({ q: "owner:me" })).workspaces),
	"getWorkspaces (shared)": async ({ scoped, memberId }) =>
		assertNonEmpty(
			(await scoped.getWorkspaces({ q: `shared_with_user:${memberId}` }))
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
	getTemplateVersion: ({ scoped, versionId }) =>
		scoped.getTemplateVersion(versionId),
	getTemplateVersionResources: async ({ scoped, versionId }) =>
		assertNonEmpty(await scoped.getTemplateVersionResources(versionId)),
	getTemplateVersionRichParameters: async ({ scoped, versionId }) =>
		assertNonEmpty(await scoped.getTemplateVersionRichParameters(versionId)),
	getTemplateVersionPresets: async ({ scoped, versionId }) =>
		assertNonEmpty(await scoped.getTemplateVersionPresets(versionId)),
	stopWorkspace: (d) => buildAsScoped(d, d.own, "stop"),
	"stopWorkspace (shared)": (d) => buildAsScoped(d, d.shared, "stop"),
	startWorkspace: (d) => buildAsScoped(d, d.own, "start"),
	"startWorkspace (shared)": (d) => buildAsScoped(d, d.shared, "start"),
	"postWorkspaceBuild (update)": (d) => updateAsScoped(d, d.own),
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
	watchInboxNotifications: receives(
		(api) => api.watchInboxNotifications([], []),
		notifyMember,
	),
};

/**
 * CLI requests the source scan can't find. Unprobed: `ping` and `speedtest`
 * dial like `ssh`, `netcheck` calls `/workspaceagents/connection`, which has
 * no RBAC check, and `support bundle` reads what other probes cover.
 */
export const cliProbes: Record<string, Probe> = {
	// Outdated with automatic updates on, so the CLI updates it with a dry-run
	"coder start": async (d) => {
		await promoteNewTemplateVersion(d.admin, d.own);
		await startWithCli(d, d.own);
	},
	"coder ssh coordinate": (d) => coordinate(d, d.own),
	"coder ssh coordinate (shared)": (d) => coordinate(d, d.shared),
	"coder ssh usage": async ({ scoped, admin, own }) =>
		scoped.getAxiosInstance().post(`/api/v2/workspaces/${own.id}/usage`, {
			agent_id: await currentAgentId(admin, own),
			app_name: "vscode",
		}),
};

/**
 * Probes no offered scope can pass, with the error they fail with. If the error
 * changes or the probe passes, the server changed: request any scope that now
 * grants it, then move the probe to `probes` or `cliProbes`.
 */
export const knownGaps: Record<string, { probe: Probe; error: string }> = {
	/**
	 * The CLI looks up the owner's org membership, which no scope grants, then
	 * the owner, which `user:read` covers only for yourself (coder/coder#30423).
	 */
	"coder start (shared)": {
		probe: (d) => startWithCli(d, d.shared),
		error: "get owning member",
	},
};

/** The probe that fails without each requested scope and its error, or why no probe can. */
export const scopeConsumers: Record<
	string,
	{ probeName: string; error: string } | { unprobed: string }
> = {
	"coder:workspaces.operate": {
		probeName: "stopWorkspace",
		error: "You do not have permission to stop this workspace",
	},
	"coder:workspaces.access": {
		probeName: "coder ssh coordinate",
		error: "coordinate?version=2.0: 404",
	},
	"workspace:create": {
		probeName: "coder start",
		error: "begin workspace dry-run",
	},
	"user:read": {
		probeName: "getAuthenticatedUser",
		error: "GET /api/v2/users/me: 404",
	},
	"user:read_personal": {
		unprobed:
			"`coder start` reads external auth links with it, which needs a linked provider",
	},
	"inbox_notification:read": {
		probeName: "watchInboxNotifications",
		error: "Unrecoverable HTTP error (403)",
	},
};

const TASKS_API =
	"Tasks API, only used on servers before 2.35, which ignore OAuth scopes";

/** Coder API methods the extension calls that need no probe, with the reason. */
export const unprobedMethods: Record<string, string> = {
	waitForBuild: "polls getWorkspaceBuildByNumber",
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

async function buildAsScoped(
	{ scoped, admin }: Deployment,
	workspace: Workspace,
	transition: "start" | "stop",
): Promise<void> {
	const { id, template_active_version_id } = workspace;
	await leavingRunning(admin, workspace, async () => {
		if (transition === "start") {
			await awaitBuildSuccess(admin, await admin.stopWorkspace(id));
		}
		await awaitBuildSuccess(
			admin,
			await (transition === "start"
				? scoped.startWorkspace(id, template_active_version_id)
				: scoped.stopWorkspace(id)),
		);
	});
}

/** Runs the extension's one-build update: a stop that queues a start. */
async function updateAsScoped(
	deployment: Deployment,
	workspace: Workspace,
): Promise<void> {
	await leavingRunning(deployment.admin, workspace, async () => {
		const ctx = await cliContext(deployment, workspace);
		const { latest_build } = await updateWorkspace(ctx, []);
		await awaitFollowUpBuild(deployment.admin, latest_build);
	});
}

async function startWithCli(
	deployment: Deployment,
	workspace: Workspace,
): Promise<void> {
	const { admin, scoped } = deployment;
	await leavingRunning(admin, workspace, async () => {
		await awaitBuildSuccess(admin, await admin.stopWorkspace(workspace.id));
		const stopped = await scoped.getWorkspace(workspace.id);
		await startWorkspace(await cliContext(deployment, stopped));
	});
}

/** Leaves the workspace running even if `probe` fails, so later probes are unaffected. */
async function leavingRunning(
	admin: Api,
	workspace: Workspace,
	probe: () => Promise<void>,
): Promise<void> {
	try {
		await probe();
	} catch (error) {
		try {
			await ensureRunning(admin, workspace);
		} catch (restoreError) {
			throw new Error(
				`${String(error)}; restoring ${workspace.name} also failed`,
				{ cause: restoreError },
			);
		}
		throw error;
	}
	await ensureRunning(admin, workspace);
}

async function ensureRunning(
	admin: Api,
	{ id, template_active_version_id }: Workspace,
): Promise<void> {
	const { latest_build } = await admin.getWorkspace(id);
	if (
		latest_build.transition !== "start" ||
		latest_build.job.status !== "succeeded"
	) {
		await awaitBuildSuccess(
			admin,
			await admin.startWorkspace(id, template_active_version_id),
		);
	}
}

async function cliContext(
	{ scoped, url, token, cliPath }: Deployment,
	workspace: Workspace,
): Promise<CliContext> {
	new MockConfigurationProvider();
	const configDir = await mkdtemp(path.join(tmpdir(), "coder-scopes-config-"));
	await writeFile(path.join(configDir, "session"), token);
	const version = semver.parse((await scoped.getBuildInfo()).version);
	return {
		restClient: scoped,
		auth: {
			url,
			allowRedirects: false,
			store: "extension",
			configDir,
			useKeyring: undefined,
		},
		binPath: cliPath,
		workspace,
		write: () => undefined,
		cliFeatures: cliFeatureSet(version),
		serverFeatures: serverFeatureSet(version),
	};
}

/** Opens the coordination socket `coder ssh` dials. */
async function coordinate(
	{ scoped, admin }: Deployment,
	workspace: Workspace,
): Promise<void> {
	const agentId = await currentAgentId(admin, workspace);
	const route = `/api/v2/workspaceagents/${agentId}/coordinate?version=2.0`;
	const socket = openSocket(scoped, route);
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("open", resolve);
			socket.once("unexpected-response", (_request, response) => {
				void text(response).then(
					(body) =>
						reject(new Error(`GET ${route}: ${response.statusCode} ${body}`)),
					reject,
				);
			});
			socket.once("error", reject);
		});
	} finally {
		socket.terminate();
	}
}

/** Passes once the stream opens, for streams that authorize only the handshake. */
function opens(open: OpenStream): Probe {
	return (deployment) => streamUrl(deployment, open);
}

/**
 * Passes on the first non-ping message, sent after `trigger` if given. Fails
 * on refusal, an error event, or an early close (a failed per-message check).
 */
function receives(
	open: OpenStream,
	trigger?: (deployment: Deployment) => Promise<void>,
): Probe {
	return async (deployment) => {
		// A plain socket listens before it connects, so unlike the extension's
		// client it cannot miss a message sent right after the handshake.
		const socket = new WebSocket(await streamUrl(deployment, open), {
			headers: { "Coder-Session-Token": deployment.token },
		});
		const received = new Promise<void>((resolve, reject) => {
			socket.on("message", (message) => {
				const event = JSON.parse(rawDataToString(message)) as {
					type?: string;
					data?: unknown;
				};
				if (event.type === "error") {
					reject(new Error(`Stream error: ${JSON.stringify(event.data)}`));
				} else if (event.type !== "ping") {
					resolve();
				}
			});
			socket.once("error", reject);
			socket.once("close", (code, reason) =>
				reject(new Error(`Closed with ${code} ${reason.toString()}`)),
			);
		});
		try {
			await Promise.all([
				received,
				once(socket, "open").then(() => trigger?.(deployment)),
			]);
		} finally {
			socket.terminate();
		}
	};
}

/**
 * Opens and closes the stream with the extension's client and returns its URL.
 * Throws what the client logged if it does not open.
 */
async function streamUrl(
	deployment: Deployment,
	open: OpenStream,
): Promise<string> {
	new MockConfigurationProvider();
	const logger = new LogCollector();
	const api = CoderApi.create(deployment.url, deployment.token, logger);
	try {
		const stream = await open(api, deployment);
		const { url } = stream;
		stream.close();
		if (!url) {
			const failure = logger.entries
				.filter(({ level }) => level === "error" || level === "warn")
				.at(-1);
			const logged = failure
				? [failure.message, ...failure.args].map(String).join(" ")
				: "nothing logged";
			throw new Error(`Stream did not open: ${logged}`);
		}
		return url;
	} finally {
		api.dispose();
	}
}

/** The agent of the workspace's latest build, the only one the server serves. */
async function currentAgentId(
	admin: Api,
	workspace: Workspace,
): Promise<string> {
	const { latest_build } = await admin.getWorkspace(workspace.id);
	const agent = latest_build.resources.flatMap((r) => r.agents ?? [])[0];
	if (!agent) {
		throw new Error(`Build ${latest_build.build_number} has no agent`);
	}
	return agent.id;
}

/** Deletes a new workspace of the member's as the admin, which notifies the member. */
async function notifyMember({ admin, own }: Deployment): Promise<void> {
	const doomed = await createRunningWorkspace(
		admin,
		own.owner_id,
		"doomed",
		own.template_id,
	);
	await awaitBuildSuccess(
		admin,
		await admin.postWorkspaceBuild(doomed.id, { transition: "delete" }),
	);
}
