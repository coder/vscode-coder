import { type WorkspaceAgent } from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";

import { type CoderApi } from "../api/coderApi";
import {
	parseDeploymentUrl,
	validateDeploymentUrl,
} from "../common/validation";
import { OAuthMetadataClient } from "../oauth/metadataClient";
import { type MementoManager } from "../storage/mementoManager";

import { withProgress } from "./progress";

import type { Logger } from "../logging/logger";

type AuthMethod = "oauth" | "legacy";

/**
 * Find the requested agent if specified, otherwise return the agent if there
 * is only one or ask the user to pick if there are multiple.  Return
 * undefined if the user cancels.
 */
export async function maybeAskAgent(
	agents: WorkspaceAgent[],
	filter?: string,
): Promise<WorkspaceAgent | undefined> {
	const filteredAgents = filter
		? agents.filter((agent) => agent.name === filter)
		: agents;
	if (filteredAgents.length === 0) {
		throw new Error("Workspace has no matching agents");
	} else if (filteredAgents.length === 1) {
		return filteredAgents[0];
	} else {
		const quickPick = vscode.window.createQuickPick();
		quickPick.title = "Select an agent";
		quickPick.busy = true;
		const agentItems: vscode.QuickPickItem[] = filteredAgents.map((agent) => {
			let icon = "$(debug-start)";
			if (agent.status !== "connected") {
				icon = "$(debug-stop)";
			}
			return {
				alwaysShow: true,
				label: `${icon} ${agent.name}`,
				detail: `${agent.name} • Status: ${agent.status}`,
			};
		});
		quickPick.items = agentItems;
		quickPick.busy = false;
		quickPick.show();

		const selected = await new Promise<WorkspaceAgent | undefined>(
			(resolve) => {
				quickPick.onDidHide(() => resolve(undefined));
				quickPick.onDidChangeSelection((selected) => {
					if (selected.length < 1) {
						return resolve(undefined);
					}
					const agent = filteredAgents[quickPick.items.indexOf(selected[0])];
					resolve(agent);
				});
			},
		);
		quickPick.dispose();
		return selected;
	}
}

/**
 * Ask the user for the URL, letting them choose from a list of recent URLs or
 * CODER_URL or enter a new one.  Undefined means the user aborted.
 */
async function askURL(
	mementoManager: MementoManager,
	prePopulateUrl: string | undefined,
): Promise<string | undefined> {
	const defaultURL = vscode.workspace
		.getConfiguration()
		.get<string>("coder.defaultUrl")
		?.trim();
	const quickPick = vscode.window.createQuickPick();
	quickPick.ignoreFocusOut = true;
	quickPick.value =
		prePopulateUrl || defaultURL || process.env.CODER_URL?.trim() || "";
	quickPick.placeholder = "https://example.coder.com";
	quickPick.title = "Enter the URL of your Coder deployment.";

	// Initial items.
	quickPick.items = mementoManager
		.withUrlHistory(defaultURL, process.env.CODER_URL)
		.map((url) => ({
			alwaysShow: true,
			label: url,
		}));

	// Quick picks do not allow arbitrary values, so we add the value itself as
	// an option in case the user wants to connect to something that is not in
	// the list.
	quickPick.onDidChangeValue((value) => {
		quickPick.items = mementoManager
			.withUrlHistory(defaultURL, process.env.CODER_URL, value)
			.map((url) => ({
				alwaysShow: true,
				label: url,
			}));
	});

	quickPick.show();

	const selected = await new Promise<string | undefined>((resolve) => {
		quickPick.onDidHide(() => resolve(undefined));
		quickPick.onDidChangeSelection((selected) => resolve(selected[0]?.label));
	});
	quickPick.dispose();
	return selected;
}

/**
 * Ask the user for the URL if it was not provided, letting them choose from a
 * list of recent URLs or the default URL or CODER_URL or enter a new one, and
 * normalizes the returned URL.  Undefined means the user aborted.
 */
export async function maybeAskUrl(
	mementoManager: MementoManager,
	providedUrl: string | undefined | null,
	prePopulateUrl?: string,
): Promise<string | undefined> {
	let url = providedUrl || (await askURL(mementoManager, prePopulateUrl));
	if (!url) {
		// User aborted.
		return undefined;
	}

	// Normalize URL.
	if (!url.startsWith("http://") && !url.startsWith("https://")) {
		// Default to HTTPS if not provided so URLs can be typed more easily.
		url = "https://" + url;
	}
	// Converts an international domain name to its ASCII (punycode) form.
	url = parseDeploymentUrl(url).href;
	while (url.endsWith("/")) {
		url = url.substring(0, url.length - 1);
	}
	// Fail before sign-in rather than when the URL reaches the SSH ProxyCommand.
	return validateDeploymentUrl(url);
}

export async function maybeAskAuthMethod(
	client: CoderApi,
	logger: Logger,
): Promise<AuthMethod | undefined> {
	const experimentalOAuthEnabled = vscode.workspace
		.getConfiguration()
		.get<boolean>("coder.experimental.oauth", false);

	if (!experimentalOAuthEnabled) {
		return "legacy";
	}

	const support = await withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Checking authentication methods",
		},
		() =>
			OAuthMetadataClient.checkOAuthSupport(client.getAxiosInstance(), logger),
	);

	if (support === "supported") {
		return await askAuthMethod();
	}
	if (support === "registration_disabled") {
		void vscode.window.showWarningMessage(
			"OAuth sign-in is unavailable: dynamic client registration is disabled on this deployment. Signing in with a session token instead.",
		);
	}
	return "legacy";
}

/**
 * Ask user to choose between OAuth and legacy API token authentication.
 */
async function askAuthMethod(): Promise<AuthMethod | undefined> {
	const choice = await vscode.window.showQuickPick(
		[
			{
				label: "OAuth (Recommended)",
				description: "Secure authentication with automatic token refresh",
				value: "oauth" as const,
			},
			{
				label: "Session Token (Legacy)",
				description: "Generate and paste a session token manually",
				value: "legacy" as const,
			},
		],
		{
			title: "Select authentication method",
			placeHolder: "How would you like to authenticate?",
			ignoreFocusOut: true,
		},
	);

	return choice?.value;
}
