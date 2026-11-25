import * as vscode from "vscode";

import { removeTrailingSlashes } from "../common/url";

import type { CoderApi } from "../api/coderApi";
import type { SessionData, SessionState } from "../deployment/sessionStore";
import type { Logger } from "../logging/logger";

const MCP_SERVER_PROVIDER_ID = "coder";
const MCP_ENDPOINT = "/api/experimental/mcp/http";
const ENABLED_SETTING = "coder.mcpServer.enabled";

/**
 * Registers the Coder MCP server provider. Returns undefined when the editor
 * lacks the MCP API, as some VS Code forks do.
 */
export function registerMcpServerProvider(
	client: Pick<CoderApi, "getExperiments" | "getAxiosInstance">,
	sessionState: SessionState,
	logger: Logger,
): vscode.Disposable | undefined {
	const provider = new McpServerProvider(client, sessionState, logger);
	try {
		const registration = vscode.lm.registerMcpServerDefinitionProvider(
			MCP_SERVER_PROVIDER_ID,
			provider,
		);
		return {
			dispose: () => {
				registration.dispose();
				provider.dispose();
			},
		};
	} catch (error) {
		provider.dispose();
		logger.info("This editor does not support MCP server definitions", error);
		return undefined;
	}
}

/**
 * Offers the deployment's hosted MCP server, when it serves one, to VS Code
 * chat and the Agents window. VS Code signs in to it with its own OAuth flow,
 * so the definition carries no credentials.
 */
export class McpServerProvider
	implements vscode.McpServerDefinitionProvider, vscode.Disposable
{
	readonly #onDidChange = new vscode.EventEmitter<void>();
	readonly #disposables: vscode.Disposable[] = [];
	#serverUrl: string | undefined;

	public readonly onDidChangeMcpServerDefinitions = this.#onDidChange.event;

	public constructor(
		private readonly client: Pick<
			CoderApi,
			"getExperiments" | "getAxiosInstance"
		>,
		private readonly sessionState: SessionState,
		private readonly logger: Logger,
	) {
		this.#disposables.push(
			this.sessionState.onDidChange((session) => {
				void this.detect(session);
			}),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration(ENABLED_SETTING)) {
					this.#onDidChange.fire();
				}
			}),
		);
		void this.detect(this.sessionState.current);
	}

	public provideMcpServerDefinitions(): vscode.McpHttpServerDefinition[] {
		const enabled = vscode.workspace
			.getConfiguration()
			.get<boolean>(ENABLED_SETTING, true);
		if (!enabled || !this.#serverUrl) {
			return [];
		}
		return [
			new vscode.McpHttpServerDefinition(
				"Coder",
				vscode.Uri.parse(this.#serverUrl),
			),
		];
	}

	public dispose(): void {
		for (const disposable of this.#disposables) {
			disposable.dispose();
		}
		this.#onDidChange.dispose();
	}

	private async detect(session: SessionData): Promise<void> {
		if (session.kind !== "signedIn") {
			this.setServerUrl(undefined);
			return;
		}
		const serverUrl = `${removeTrailingSlashes(session.deployment.url)}${MCP_ENDPOINT}`;
		if (this.#serverUrl !== serverUrl) {
			this.setServerUrl(undefined);
		}
		const available = await this.isServerAvailable();
		// A sign-out or deployment switch during the checks supersedes them.
		if (this.sessionState.current === session) {
			this.setServerUrl(available ? serverUrl : undefined);
		}
	}

	/**
	 * The endpoint authenticates before checking its gates, so an
	 * unauthenticated probe returns 401 even when disabled. Check the gates
	 * directly: the `mcp-server-http` experiment and the OAuth2 provider, whose
	 * resource metadata VS Code needs to sign in.
	 */
	private async isServerAvailable(): Promise<boolean> {
		try {
			const experiments = await this.client.getExperiments();
			if (!experiments.includes("mcp-server-http")) {
				this.logger.debug("Coder MCP server unavailable: experiment disabled");
				return false;
			}
			await this.client
				.getAxiosInstance()
				.get(`/.well-known/oauth-protected-resource${MCP_ENDPOINT}`);
			this.logger.info("Coder MCP server available");
			return true;
		} catch (error) {
			this.logger.debug("Coder MCP server unavailable", error);
			return false;
		}
	}

	private setServerUrl(url: string | undefined): void {
		if (this.#serverUrl === url) {
			return;
		}
		this.#serverUrl = url;
		this.#onDidChange.fire();
	}
}
