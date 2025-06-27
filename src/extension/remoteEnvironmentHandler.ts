import axios, { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import * as vscode from "vscode";
import { makeCoderSdk } from "../api";
import { errToStr } from "../api-helper";
import { Commands } from "../commands";
import { getErrorDetail } from "../error";
import { Remote } from "../remote";
import { Storage } from "../storage";
import { ExtensionDependencies } from "./dependencies";

export class RemoteEnvironmentHandler {
	private readonly vscodeProposed: typeof vscode;
	private readonly remoteSSHExtension: vscode.Extension<unknown> | undefined;
	private readonly restClient: ReturnType<typeof makeCoderSdk>;
	private readonly storage: Storage;
	private readonly commands: Commands;
	private readonly extensionMode: vscode.ExtensionMode;

	constructor(
		deps: ExtensionDependencies,
		extensionMode: vscode.ExtensionMode,
	) {
		this.vscodeProposed = deps.vscodeProposed;
		this.remoteSSHExtension = deps.remoteSSHExtension;
		this.restClient = deps.restClient;
		this.storage = deps.storage;
		this.commands = deps.commands;
		this.extensionMode = extensionMode;
	}

	async initialize(): Promise<boolean> {
		// Skip if no remote SSH extension or no remote authority
		if (!this.remoteSSHExtension || !this.vscodeProposed.env.remoteAuthority) {
			return true; // No remote environment to handle
		}

		const remote = new Remote(
			this.vscodeProposed,
			this.storage,
			this.commands,
			this.extensionMode,
		);

		try {
			const details = await remote.setup(
				this.vscodeProposed.env.remoteAuthority,
			);
			if (details) {
				// Authenticate the plugin client
				this.restClient.setHost(details.url);
				this.restClient.setSessionToken(details.token);
			}
			return true; // Success
		} catch (ex) {
			await this.handleRemoteError(ex);
			// Always close remote session when we fail to open a workspace
			await remote.closeRemote();
			return false; // Failed
		}
	}

	private async handleRemoteError(error: unknown): Promise<void> {
		if (
			error &&
			typeof error === "object" &&
			"x509Err" in error &&
			"showModal" in error
		) {
			const certError = error as {
				x509Err?: string;
				message?: string;
				showModal: (title: string) => Promise<void>;
			};
			this.storage.writeToCoderOutputChannel(
				certError.x509Err || certError.message || "Certificate error",
			);
			await certError.showModal("Failed to open workspace");
		} else if (isAxiosError(error)) {
			const msg = getErrorMessage(error, "None");
			const detail = getErrorDetail(error) || "None";
			const urlString = axios.getUri(error.config);
			const method = error.config?.method?.toUpperCase() || "request";
			const status = error.response?.status || "None";
			const message = `API ${method} to '${urlString}' failed.\nStatus code: ${status}\nMessage: ${msg}\nDetail: ${detail}`;
			this.storage.writeToCoderOutputChannel(message);
			await this.vscodeProposed.window.showErrorMessage(
				"Failed to open workspace",
				{
					detail: message,
					modal: true,
					useCustom: true,
				},
			);
		} else {
			const message = errToStr(error, "No error message was provided");
			this.storage.writeToCoderOutputChannel(message);
			await this.vscodeProposed.window.showErrorMessage(
				"Failed to open workspace",
				{
					detail: message,
					modal: true,
					useCustom: true,
				},
			);
		}
	}
}
