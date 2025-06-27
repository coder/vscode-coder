import * as vscode from "vscode";
import {
	registerUriHandler,
	registerCommands,
	initializeAuthentication,
} from "../extension";
import { ExtensionDependencies } from "./dependencies";
import { RemoteEnvironmentHandler } from "./remoteEnvironmentHandler";

export class ExtensionInitializer {
	private readonly deps: ExtensionDependencies;
	private readonly ctx: vscode.ExtensionContext;

	constructor(deps: ExtensionDependencies, ctx: vscode.ExtensionContext) {
		this.deps = deps;
		this.ctx = ctx;
	}

	async initialize(): Promise<void> {
		// Register URI handler and commands
		this.registerHandlers();

		// Handle remote environment if applicable
		const remoteHandler = new RemoteEnvironmentHandler(
			this.deps,
			this.ctx.extensionMode,
		);
		const remoteHandled = await remoteHandler.initialize();
		if (!remoteHandled) {
			return; // Exit early if remote setup failed
		}

		// Initialize authentication
		await initializeAuthentication(
			this.deps.restClient,
			this.deps.storage,
			this.deps.myWorkspacesProvider,
			this.deps.allWorkspacesProvider,
		);
	}

	private registerHandlers(): void {
		// Register URI handler
		registerUriHandler(
			this.deps.commands,
			this.deps.restClient,
			this.deps.storage,
		);

		// Register commands
		registerCommands(
			this.deps.commands,
			this.deps.myWorkspacesProvider,
			this.deps.allWorkspacesProvider,
		);
	}
}
