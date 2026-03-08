import * as vscode from "vscode";

import { CoderApi } from "../api/coderApi";
import { type Logger } from "../logging/logger";
import { LoginCoordinator } from "../login/loginCoordinator";

import { CliCredentialManager } from "./cliCredentialManager";
import { CliManager } from "./cliManager";
import { ContextManager } from "./contextManager";
import { MementoManager } from "./mementoManager";
import { PathResolver } from "./pathResolver";
import { SecretsManager } from "./secretsManager";

/**
 * Service container for dependency injection.
 * Centralizes the creation and management of all core services.
 */
export class ServiceContainer implements vscode.Disposable {
	private readonly logger: vscode.LogOutputChannel;
	private readonly pathResolver: PathResolver;
	private readonly mementoManager: MementoManager;
	private readonly secretsManager: SecretsManager;
	private readonly cliCredentialManager: CliCredentialManager;
	private readonly cliManager: CliManager;
	private readonly contextManager: ContextManager;
	private readonly loginCoordinator: LoginCoordinator;

	constructor(context: vscode.ExtensionContext) {
		this.logger = vscode.window.createOutputChannel("Coder", { log: true });
		this.pathResolver = new PathResolver(
			context.globalStorageUri.fsPath,
			context.logUri.fsPath,
		);
		this.mementoManager = new MementoManager(context.globalState);
		this.secretsManager = new SecretsManager(
			context.secrets,
			context.globalState,
			this.logger,
		);
		// Circular ref: cliCredentialManager ↔ cliManager. The resolver
		// closure captures `ref` which starts undefined, so it must only
		// be called after construction completes.
		const cliManagerRef: { current: CliManager | undefined } = {
			current: undefined,
		};
		this.cliCredentialManager = new CliCredentialManager(
			this.logger,
			async (url) => {
				if (!cliManagerRef.current) {
					throw new Error(
						"BinaryResolver called before CliManager was initialised",
					);
				}
				try {
					return await cliManagerRef.current.locateBinary(url);
				} catch {
					const client = CoderApi.create(url, "", this.logger);
					return cliManagerRef.current.fetchBinary(client);
				}
			},
			this.pathResolver,
		);
		this.cliManager = new CliManager(
			this.logger,
			this.pathResolver,
			this.cliCredentialManager,
		);
		cliManagerRef.current = this.cliManager;
		this.contextManager = new ContextManager(context);
		this.loginCoordinator = new LoginCoordinator(
			this.secretsManager,
			this.mementoManager,
			this.logger,
			this.cliCredentialManager,
			context.extension.id,
		);
	}

	getPathResolver(): PathResolver {
		return this.pathResolver;
	}

	getMementoManager(): MementoManager {
		return this.mementoManager;
	}

	getSecretsManager(): SecretsManager {
		return this.secretsManager;
	}

	getLogger(): Logger {
		return this.logger;
	}

	getCliManager(): CliManager {
		return this.cliManager;
	}

	getContextManager(): ContextManager {
		return this.contextManager;
	}

	getCliCredentialManager(): CliCredentialManager {
		return this.cliCredentialManager;
	}

	getLoginCoordinator(): LoginCoordinator {
		return this.loginCoordinator;
	}

	/**
	 * Dispose of all services and clean up resources.
	 */
	dispose(): void {
		this.contextManager.dispose();
		this.logger.dispose();
		this.loginCoordinator.dispose();
	}
}
