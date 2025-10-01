import * as vscode from "vscode";

import { type Logger } from "../logging/logger";

import { CliManager } from "./cliManager";
import { MementoManager } from "./mementoManager";
import { PathResolver } from "./pathResolver";
import { SecretsManager } from "./secretsManager";

/**
 * Service container for dependency injection.
 * Centralizes the creation and management of all core services.
 */
export class ServiceContainer {
	private readonly logger: vscode.LogOutputChannel;
	private readonly pathResolver: PathResolver;
	private readonly mementoManager: MementoManager;
	private readonly secretsManager: SecretsManager;
	private readonly cliManager: CliManager;

	constructor(
		context: vscode.ExtensionContext,
		private readonly vscodeProposed: typeof vscode = vscode,
	) {
		this.logger = vscode.window.createOutputChannel("Coder", { log: true });
		this.pathResolver = new PathResolver(
			context.globalStorageUri.fsPath,
			context.logUri.fsPath,
		);
		this.mementoManager = new MementoManager(context.globalState);
		this.secretsManager = new SecretsManager(context.secrets);
		this.cliManager = new CliManager(
			this.vscodeProposed,
			this.logger,
			this.pathResolver,
		);
	}

	getVsCodeProposed(): typeof vscode {
		return this.vscodeProposed;
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

	/**
	 * Dispose of all services and clean up resources.
	 */
	dispose(): void {
		this.logger.dispose();
	}
}
