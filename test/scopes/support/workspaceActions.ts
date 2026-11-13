import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as semver from "semver";

import { startWorkspace, updateWorkspace } from "@/api/workspace";
import { fullName } from "@/cli/cliBinary";
import { serverFeatureSet } from "@/featureSet";

import { connect } from "./server";
import {
	awaitBuildSuccess,
	awaitFollowUpBuild,
	currentAgentId,
	promoteNewTemplateVersion,
} from "./workspaces";

import type { Workspace } from "coder/site/src/api/typesGenerated";

import type { Deployment } from "./deployment";

type CliContext = Parameters<typeof startWorkspace>[0];

interface Cli {
	binPath: string;
	/** Holds the `session` file the CLI authenticates with. */
	configDir: string;
}

/**
 * Sends the requests `coder ssh` makes before it connects. The CLI only logs a
 * failed usage report, so a missing scope there lets the workspace autostop
 * while in use.
 */
export async function ssh(
	{ scoped, admin }: Deployment,
	workspace: Workspace,
): Promise<void> {
	const agentId = await currentAgentId(admin, workspace);
	await scoped.getAxiosInstance().get(`/api/v2/workspaceagents/${agentId}`);
	await scoped.postWorkspaceUsage(workspace.id, {
		agent_id: agentId,
		app_name: "vscode",
	});
	await connect(
		scoped,
		`/api/v2/workspaceagents/${agentId}/coordinate?version=2.0`,
	);
}

/** Runs the extension's one-build update: a stop that queues a start. */
export async function updateInOneBuild(deployment: Deployment): Promise<void> {
	// This path never runs the CLI.
	const noCli: Cli = { binPath: "", configDir: "" };
	const ctx = await cliContext(deployment, deployment.own, noCli);
	if (!ctx.serverFeatures.onSuccessBuild) {
		throw new Error(
			"The server is older than 2.36, so updates take two builds",
		);
	}
	const { latest_build } = await updateWorkspace(ctx, []);
	await awaitFollowUpBuild(deployment.admin, latest_build);
}

/**
 * Runs the extension's `coder start` with the CLI the server serves. The
 * workspace is stopped and outdated with automatic updates on, so the CLI
 * also dry-runs the update.
 */
export async function startOutdatedWithCli(
	deployment: Deployment,
): Promise<void> {
	const { admin, own } = deployment;
	await admin.updateWorkspaceAutomaticUpdates(own.id, "always");
	await promoteNewTemplateVersion(admin, own);
	await awaitBuildSuccess(admin, await admin.stopWorkspace(own.id));
	const stopped = await admin.getWorkspace(own.id);

	const configDir = await mkdtemp(path.join(tmpdir(), "coder-scopes-"));
	try {
		const binPath = path.join(configDir, fullName());
		const { data } = await admin
			.getAxiosInstance()
			.get<ArrayBuffer>(`/bin/${fullName()}`, { responseType: "arraybuffer" });
		await writeFile(binPath, Buffer.from(data), { mode: 0o755 });
		await writeFile(path.join(configDir, "session"), deployment.token);
		await startWorkspace(
			await cliContext(deployment, stopped, { binPath, configDir }),
		);
	} finally {
		await rm(configDir, { recursive: true, force: true });
	}
}

async function cliContext(
	{ scoped, url }: Deployment,
	workspace: Workspace,
	{ binPath, configDir }: Cli,
): Promise<CliContext> {
	const version = semver.parse((await scoped.getBuildInfo()).version);
	return {
		restClient: scoped,
		auth: {
			url,
			refuseRedirects: false,
			store: "extension",
			configDir,
			useKeyring: false,
		},
		binPath,
		workspace,
		write: () => undefined,
		serverFeatures: serverFeatureSet(version),
	};
}
