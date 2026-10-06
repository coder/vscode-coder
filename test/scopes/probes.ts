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

import { LogCollector } from "../mocks/testHelpers";

import {
	awaitBuildSuccess,
	awaitFollowUpBuild,
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
 * `method (variant)`; `scopeProbes.test.ts` checks the keys. Probes run in
 * order.
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
	// Mutating probes run last and leave the workspace running.
	"postWorkspaceBuild (update)": updateAsScoped,
};

/**
 * CLI requests the source scan can't find. Unprobed: `ping` and `speedtest`
 * dial like `ssh`, `netcheck` calls `/workspaceagents/connection`, which has
 * no RBAC check, and `support bundle` reads what other probes cover.
 */
export const cliProbes: Record<string, Probe> = {
	"coder ssh": (d) => ssh(d, d.own),
	"coder ssh (shared)": (d) => ssh(d, d.shared),
	// Outdated with automatic updates on, so the CLI updates it with a dry-run
	"coder start": async (d) => {
		await promoteNewTemplateVersion(d.admin, d.own);
		await startWithCli(d);
	},
};

const TASKS_API =
	"Tasks API, only used on servers before 2.35, which ignore OAuth scopes";

const REST_BUILDS =
	"tasks panel and updates with CLIs before 2.24; servers that enforce scopes update in one build";

/** Coder API methods the extension calls that need no probe, with the reason. */
export const unprobedMethods: Record<string, string> = {
	waitForBuild: "polls getWorkspaceBuildByNumber",
	startWorkspace: REST_BUILDS,
	stopWorkspace: REST_BUILDS,
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

/** Runs the extension's one-build update: a stop that queues a start. */
async function updateAsScoped(deployment: Deployment): Promise<void> {
	const ctx = await cliContext(deployment, deployment.own);
	if (!ctx.serverFeatures.onSuccessBuild) {
		throw new Error(
			"The server is older than 2.36, so updates take two builds",
		);
	}
	const { latest_build } = await updateWorkspace(ctx, []);
	await awaitFollowUpBuild(deployment.admin, latest_build);
}

async function startWithCli(deployment: Deployment): Promise<void> {
	const { admin, scoped, own } = deployment;
	await awaitBuildSuccess(admin, await admin.stopWorkspace(own.id));
	const stopped = await scoped.getWorkspace(own.id);
	await startWorkspace(await cliContext(deployment, stopped));
}

async function cliContext(
	{ scoped, url, token, cliPath }: Deployment,
	workspace: Workspace,
): Promise<CliContext> {
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

/**
 * Sends the requests `coder ssh` makes before it connects. The CLI only logs a
 * failed usage report, so a missing scope there lets the workspace autostop
 * while in use.
 */
async function ssh(
	{ scoped, admin }: Deployment,
	workspace: Workspace,
): Promise<void> {
	const agentId = await currentAgentId(admin, workspace);
	await scoped.getAxiosInstance().get(`/api/v2/workspaceagents/${agentId}`);
	await scoped.postWorkspaceUsage(workspace.id, {
		agent_id: agentId,
		app_name: "vscode",
	});
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
 * Passes on the first non-ping message. Fails on refusal, an error event, or
 * an early close (a failed per-message check).
 */
function receives(open: OpenStream): Probe {
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
			await received;
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
