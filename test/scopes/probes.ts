import WebSocket from "ws";

import { CoderApi } from "@/api/coderApi";

import {
	createMockLogger,
	MockConfigurationProvider,
} from "../mocks/testHelpers";

import {
	createRunningWorkspace,
	waitForBuild,
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

/**
 * One probe per Coder API method the extension calls. Keys are the method
 * name, optionally followed by a variant in parentheses; `scopeProbes.test.ts`
 * checks the keys against the source.
 */
export const probes: Record<string, Probe> = {
	getBuildInfo: ({ scoped }) => scoped.getBuildInfo(),
	getAuthenticatedUser: ({ scoped }) => scoped.getAuthenticatedUser(),
	getAppearance: ({ scoped }) => scoped.getAppearance(),
	getDeploymentSSHConfig: ({ scoped }) => scoped.getDeploymentSSHConfig(),
	getWorkspaces: async ({ scoped }) =>
		nonEmpty((await scoped.getWorkspaces({ q: "owner:me" })).workspaces),
	getWorkspace: ({ scoped, own }) => scoped.getWorkspace(own.id),
	getWorkspaceByOwnerAndName: ({ scoped, own }) =>
		scoped.getWorkspaceByOwnerAndName(own.owner_name, own.name),
	"getWorkspaceByOwnerAndName (shared)": ({ scoped, shared }) =>
		scoped.getWorkspaceByOwnerAndName(shared.owner_name, shared.name),
	getWorkspaceBuildByNumber: ({ scoped, own }) =>
		scoped.getWorkspaceBuildByNumber(own.owner_name, own.name, 1),
	getWorkspaceBuildParameters: async ({ scoped, own }) =>
		nonEmpty(await scoped.getWorkspaceBuildParameters(own.latest_build.id)),
	getTemplate: ({ scoped, own }) => scoped.getTemplate(own.template_id),
	getTemplateVersion: ({ scoped, versionId }) =>
		scoped.getTemplateVersion(versionId),
	getTemplateVersionResources: async ({ scoped, versionId }) =>
		nonEmpty(await scoped.getTemplateVersionResources(versionId)),
	getTemplateVersionRichParameters: async ({ scoped, versionId }) =>
		nonEmpty(await scoped.getTemplateVersionRichParameters(versionId)),
	getTemplateVersionPresets: async ({ scoped, versionId }) =>
		nonEmpty(await scoped.getTemplateVersionPresets(versionId)),
	stopWorkspace: (d) => buildAsScoped(d, d.own, "stop"),
	"stopWorkspace (shared)": (d) => buildAsScoped(d, d.shared, "stop"),
	startWorkspace: (d) => buildAsScoped(d, d.own, "start"),
	"startWorkspace (shared)": (d) => buildAsScoped(d, d.shared, "start"),
	watchWorkspace: receives((api, { own }) => api.watchWorkspace(own)),
	watchAgentMetadata: receives(async (api, deployment) =>
		api.watchAgentMetadata(await currentAgentId(deployment)),
	),
	watchBuildLogsByBuildId: opens((api, { own }) =>
		api.watchBuildLogsByBuildId(own.latest_build.id, []),
	),
	watchWorkspaceAgentLogs: opens(async (api, deployment) =>
		api.watchWorkspaceAgentLogs(await currentAgentId(deployment), []),
	),
};

/**
 * Probes that fail with DEFAULT_OAUTH_SCOPES because no requestable scope
 * grants what they need, with the error they fail with. Once the server fixes
 * one, its test fails, and the probe moves to `probes`.
 */
export const knownGaps: Record<string, { probe: Probe; error: string }> = {
	/** Each notification needs inbox_notification:read, so the server closes the socket instead. */
	watchInboxNotifications: {
		probe: receives((api) => api.watchInboxNotifications([], []), notifyMember),
		error: "Closed with 1000",
	},
};

/** Requests the CLI makes, which the source scan cannot find. */
export const cliProbes: Record<string, Probe> = {
	/** `coder start` dry-runs the build when the workspace must update first. */
	"coder start dry-run": ({ scoped, versionId }) =>
		scoped
			.getAxiosInstance()
			.post(`/api/v2/templateversions/${versionId}/dry-run`, {}),
};

/** Only used on servers before 2.35, which ignore OAuth scopes. */
const TASKS_API = "Tasks API";

/** Coder API methods the extension calls that need no probe, with the reason. */
export const unprobedMethods: Record<string, string> = {
	postWorkspaceBuild:
		"sends the same builds as startWorkspace and stopWorkspace",
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

/**
 * Fails on an empty list: the server drops rows the token cannot read instead
 * of refusing the request, so a scope gap there still returns 200.
 */
function nonEmpty(items: readonly unknown[] | null): void {
	if (!items?.length) {
		throw new Error("Expected at least one item");
	}
}

/**
 * Runs `transition` on the workspace as the scoped user, stopping it first as
 * the admin for a start. Leaves it running either way, so a failed probe
 * cannot break the probes after it.
 */
async function buildAsScoped(
	{ scoped, admin }: Deployment,
	{ id, template_active_version_id }: Workspace,
	transition: "start" | "stop",
): Promise<void> {
	const build = async (api: Api, to: "start" | "stop") =>
		waitForBuild(
			admin,
			await (to === "start"
				? api.startWorkspace(id, template_active_version_id)
				: api.stopWorkspace(id)),
		);
	try {
		if (transition === "start") {
			await build(admin, "stop");
		}
		await build(scoped, transition);
	} finally {
		const { latest_build } = await admin.getWorkspace(id);
		if (
			latest_build.transition !== "start" ||
			latest_build.job.status !== "succeeded"
		) {
			await build(admin, "start");
		}
	}
}

/** Passes once the stream opens, for streams that authorize only the handshake. */
function opens(open: OpenStream): Probe {
	return (deployment) => openStream(deployment, open);
}

/**
 * Passes on the stream's first message, sent after `trigger` when given. Fails
 * if the server refuses the stream, or closes it first as it does when a
 * per-message permission check fails.
 */
function receives(
	open: OpenStream,
	trigger?: (deployment: Deployment) => Promise<void>,
): Probe {
	return async (deployment) => {
		// A plain socket listens before it connects, so unlike the extension's
		// client it cannot miss a message sent right after the handshake.
		const socket = new WebSocket(await openStream(deployment, open), {
			headers: { "Coder-Session-Token": deployment.token },
		});
		const received = new Promise<void>((resolve, reject) => {
			socket.once("message", () => resolve());
			socket.once("error", reject);
			socket.once("close", (code, reason) =>
				reject(new Error(`Closed with ${code} ${reason.toString()}`)),
			);
		});
		try {
			await Promise.all([received, trigger?.(deployment)]);
		} finally {
			socket.terminate();
		}
	};
}

/**
 * Opens the stream with the extension's client, set up as the extension does
 * with default settings, and returns its URL so probes follow the extension's
 * routes. Throws if the server refuses the handshake.
 */
async function openStream(
	deployment: Deployment,
	open: OpenStream,
): Promise<string> {
	let refusal = "";
	new MockConfigurationProvider();
	const api = CoderApi.create(
		deployment.url,
		deployment.token,
		createMockLogger(),
		undefined,
		(reason, route) => {
			refusal = `${route} (${reason})`;
		},
	);
	try {
		const stream = await open(api, deployment);
		const { url } = stream;
		stream.close();
		if (!url) {
			throw new Error(`Server refused ${refusal}`);
		}
		return url;
	} finally {
		api.dispose();
	}
}

/** The agent of the member's latest build, the only one the server serves. */
async function currentAgentId({ admin, own }: Deployment): Promise<string> {
	const { latest_build } = await admin.getWorkspace(own.id);
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
	await waitForBuild(
		admin,
		await admin.postWorkspaceBuild(doomed.id, { transition: "delete" }),
	);
}
