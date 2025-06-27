import * as vscode from "vscode";
import { makeCoderSdk } from "../api";
import { Commands } from "../commands";
import {
	setupRemoteSSHExtension,
	initializeInfrastructure,
	initializeRestClient,
	setupTreeViews,
} from "../extension";
import { Logger } from "../logger";
import { Storage } from "../storage";
import { DefaultUIProvider } from "../uiProvider";
import { WorkspaceProvider } from "../workspacesProvider";

export class ExtensionDependencies {
	public readonly vscodeProposed: typeof vscode;
	public readonly remoteSSHExtension: vscode.Extension<unknown> | undefined;
	public readonly output: vscode.OutputChannel;
	public readonly storage: Storage;
	public readonly logger: Logger;
	public readonly restClient: ReturnType<typeof makeCoderSdk>;
	public readonly uiProvider: DefaultUIProvider;
	public readonly commands: Commands;
	public readonly myWorkspacesProvider: WorkspaceProvider;
	public readonly allWorkspacesProvider: WorkspaceProvider;

	private constructor(
		vscodeProposed: typeof vscode,
		remoteSSHExtension: vscode.Extension<unknown> | undefined,
		output: vscode.OutputChannel,
		storage: Storage,
		logger: Logger,
		restClient: ReturnType<typeof makeCoderSdk>,
		uiProvider: DefaultUIProvider,
		commands: Commands,
		myWorkspacesProvider: WorkspaceProvider,
		allWorkspacesProvider: WorkspaceProvider,
	) {
		this.vscodeProposed = vscodeProposed;
		this.remoteSSHExtension = remoteSSHExtension;
		this.output = output;
		this.storage = storage;
		this.logger = logger;
		this.restClient = restClient;
		this.uiProvider = uiProvider;
		this.commands = commands;
		this.myWorkspacesProvider = myWorkspacesProvider;
		this.allWorkspacesProvider = allWorkspacesProvider;
	}

	static async create(
		ctx: vscode.ExtensionContext,
	): Promise<ExtensionDependencies> {
		// Setup remote SSH extension
		const { vscodeProposed, remoteSSHExtension } = setupRemoteSSHExtension();

		// Create output channel
		const output = vscode.window.createOutputChannel("Coder");

		// Initialize infrastructure
		const { storage, logger } = await initializeInfrastructure(ctx, output);

		// Initialize REST client
		const restClient = await initializeRestClient(storage);

		// Setup tree views
		const { myWorkspacesProvider, allWorkspacesProvider } = setupTreeViews(
			restClient,
			storage,
		);

		// Create UI provider and commands
		const uiProvider = new DefaultUIProvider(vscodeProposed.window);
		const commands = new Commands(
			vscodeProposed,
			restClient,
			storage,
			uiProvider,
		);

		return new ExtensionDependencies(
			vscodeProposed,
			remoteSSHExtension,
			output,
			storage,
			logger,
			restClient,
			uiProvider,
			commands,
			myWorkspacesProvider,
			allWorkspacesProvider,
		);
	}
}
