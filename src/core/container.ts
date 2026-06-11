import * as vscode from "vscode";

import { CoderApi } from "../api/coderApi";
import { AuthTelemetry } from "../instrumentation/auth";
import { LoginCoordinator } from "../login/loginCoordinator";
import { OAuthCallback } from "../oauth/oauthCallback";
import { buildSession, extractExtensionVersion } from "../telemetry/event";
import { newSessionId } from "../telemetry/ids";
import { TelemetryService } from "../telemetry/service";
import { LocalJsonlSink } from "../telemetry/sinks/localJsonlSink";
import { SpeedtestPanelFactory } from "../webviews/speedtest/speedtestPanelFactory";
import { DuplicateWorkspaceIpc } from "../workspace/duplicateWorkspaceIpc";

import { CliCredentialManager } from "./cliCredentialManager";
import { CliManager } from "./cliManager";
import { CommandManager } from "./commandManager";
import { ContextManager } from "./contextManager";
import { MementoManager } from "./mementoManager";
import { PathResolver } from "./pathResolver";
import { SecretsManager } from "./secretsManager";

import type { Logger } from "../logging/logger";

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
	private readonly duplicateWorkspaceIpc: DuplicateWorkspaceIpc;
	private readonly oauthCallback: OAuthCallback;
	private readonly speedtestPanelFactory: SpeedtestPanelFactory;
	private readonly telemetryService: TelemetryService;
	private readonly commandManager: CommandManager;

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

		const session = buildSession(
			extractExtensionVersion(context.extension.packageJSON),
			newSessionId(),
		);
		const localJsonlSink = LocalJsonlSink.start(
			{
				baseDir: this.pathResolver.getTelemetryPath(),
				session,
			},
			this.logger,
		);
		this.telemetryService = new TelemetryService(
			session,
			[localJsonlSink],
			this.logger,
		);

		// Circular ref: cliCredentialManager ↔ cliManager. The resolver
		// closure captures `this` by reference, so `this.cliManager` is
		// available when the closure is called (after construction).
		this.cliCredentialManager = new CliCredentialManager(
			this.logger,
			async (url) => {
				if (!this.cliManager) {
					throw new Error(
						"BinaryResolver called before CliManager was initialised",
					);
				}
				try {
					return await this.cliManager.locateBinary(url);
				} catch {
					const client = CoderApi.create(url, "", this.logger);
					return this.cliManager.fetchBinary(client);
				}
			},
			this.pathResolver,
			this.telemetryService,
		);
		this.cliManager = new CliManager(
			this.logger,
			this.pathResolver,
			this.cliCredentialManager,
			this.telemetryService,
		);
		this.contextManager = new ContextManager(context);
		this.oauthCallback = new OAuthCallback(context.secrets, this.logger);
		this.loginCoordinator = new LoginCoordinator(
			this.secretsManager,
			this.mementoManager,
			this.logger,
			this.cliCredentialManager,
			new AuthTelemetry(this.telemetryService),
			this.oauthCallback,
			context.extension.id,
		);
		this.duplicateWorkspaceIpc = new DuplicateWorkspaceIpc(
			context.secrets,

			this.logger,
		);
		this.speedtestPanelFactory = new SpeedtestPanelFactory(
			context.extensionUri,
			this.logger,
		);

		this.commandManager = new CommandManager(this.telemetryService);
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

	getDuplicateWorkspaceIpc(): DuplicateWorkspaceIpc {
		return this.duplicateWorkspaceIpc;
	}

	getOAuthCallback(): OAuthCallback {
		return this.oauthCallback;
	}

	getSpeedtestPanelFactory(): SpeedtestPanelFactory {
		return this.speedtestPanelFactory;
	}

	getTelemetryService(): TelemetryService {
		return this.telemetryService;
	}

	getCommandManager(): CommandManager {
		return this.commandManager;
	}

	/** Dispose logger last so telemetry teardown warnings still reach it. */
	async dispose(): Promise<void> {
		this.commandManager.dispose();
		this.contextManager.dispose();
		this.loginCoordinator.dispose();
		try {
			await this.telemetryService.dispose();
		} finally {
			this.logger.dispose();
		}
	}
}
