import { findAgent } from "../api/models";
import { WorkspaceMonitor } from "../workspace/workspaceMonitor";

import { parseRemoteAuthority } from "./authority";
import { WorkspaceStateMachine } from "./workspaceStateMachine";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "../api/coderApi";
import type { ServiceContainer } from "../container";
import type { AgentsWindowOpenTrace } from "../instrumentation/workspaceOpen";

import type { ConnectionSetup } from "./connectionSetup";

export interface AgentsWindowConnectionOptions {
	client: CoderApi;
	baseUrl: string;
	workspace: Workspace;
	remoteAuthority: string;
	connectionSetup: ConnectionSetup;
	serviceContainer: ServiceContainer;
	trace: AgentsWindowOpenTrace;
}

/**
 * Start the workspace if needed and write the SSH config the Agents window
 * connects with. The Agents window has no Remote-SSH and runs plain `ssh`
 * against `~/.ssh/config`, so the config goes there.
 *
 * Returns the workspace and agent once the agent is ready.
 */
export async function prepareAgentsWindowConnection(
	options: AgentsWindowConnectionOptions,
): Promise<{ workspace: Workspace; agent: WorkspaceAgent }> {
	const { baseUrl, client, connectionSetup, serviceContainer, trace } = options;
	const parts = parseRemoteAuthority(options.remoteAuthority);
	if (!parts) {
		throw new Error(`Not a Coder remote authority: ${options.remoteAuthority}`);
	}

	const binaryPath = await trace.phase("cli_resolve", () =>
		connectionSetup.resolveBinary(client),
	);
	const { serverFeatures, cliAuth, sessionApp } = await trace.phase(
		"compatibility_check",
		() =>
			connectionSetup.checkCompatibility({
				workspaceClient: client,
				binaryPath,
				baseUrl,
				safeHostname: parts.safeHostname,
			}),
	);
	await trace.phase("cli_configure", () =>
		serviceContainer
			.getCliManager()
			.configure(baseUrl, client.getSessionToken() ?? ""),
	);

	const monitor = await trace.phase("workspace_monitor_setup", () =>
		WorkspaceMonitor.create(options.workspace, client, serviceContainer),
	);
	const stateMachine = new WorkspaceStateMachine(
		parts,
		client,
		"none",
		binaryPath,
		serverFeatures,
		cliAuth,
		serviceContainer,
	);
	let workspace: Workspace;
	try {
		workspace = await trace.phase("workspace_ready", () =>
			connectionSetup.waitForWorkspaceReady(
				options.workspace,
				monitor,
				stateMachine,
			),
		);
	} finally {
		stateMachine.dispose();
		monitor.dispose();
	}
	const agentId = stateMachine.getAgentId();
	const agent = agentId ? findAgent(workspace, agentId) : undefined;
	if (!agent) {
		throw new Error("Failed to get workspace or agent from state machine");
	}

	await trace.phase("ssh_config_write", () =>
		connectionSetup.writeSshConfig({
			workspaceClient: client,
			parts,
			binaryPath,
			logDir: serviceContainer.getPathResolver().getProxyLogPath(),
			cliAuth,
			sessionApp,
			configFile: undefined,
			sshPath: undefined,
		}),
	);
	return { workspace, agent };
}
