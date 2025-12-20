import * as vscode from "vscode";

import { errToStr } from "../api/api-helper";
import { type Commands } from "../commands";
import { type ServiceContainer } from "../core/container";
import { type DeploymentManager } from "../deployment/deploymentManager";
import { maybeAskUrl } from "../promptUtils";
import { toSafeHost } from "../util";

interface UriRouteContext {
	params: URLSearchParams;
	serviceContainer: ServiceContainer;
	deploymentManager: DeploymentManager;
	commands: Commands;
}

type UriRouteHandler = (ctx: UriRouteContext) => Promise<void>;

const routes: Record<string, UriRouteHandler> = {
	"/open": handleOpen,
	"/openDevContainer": handleOpenDevContainer,
};

/**
 * Registers the URI handler for `{vscode.env.uriScheme}://coder.coder-remote`... URIs.
 */
export function registerUriHandler(
	serviceContainer: ServiceContainer,
	deploymentManager: DeploymentManager,
	commands: Commands,
	vscodeProposed: typeof vscode,
): vscode.Disposable {
	const output = serviceContainer.getLogger();

	return vscode.window.registerUriHandler({
		handleUri: async (uri) => {
			try {
				await routeUri(uri, serviceContainer, deploymentManager, commands);
			} catch (error) {
				const message = errToStr(error, "No error message was provided");
				output.warn(`Failed to handle URI ${uri.toString()}: ${message}`);
				vscodeProposed.window.showErrorMessage("Failed to handle URI", {
					detail: message,
					modal: true,
					useCustom: true,
				});
			}
		},
	});
}

async function routeUri(
	uri: vscode.Uri,
	serviceContainer: ServiceContainer,
	deploymentManager: DeploymentManager,
	commands: Commands,
): Promise<void> {
	const handler = routes[uri.path];
	if (!handler) {
		throw new Error(`Unknown path ${uri.path}`);
	}

	await handler({
		params: new URLSearchParams(uri.query),
		serviceContainer,
		deploymentManager,
		commands,
	});
}

function getRequiredParam(params: URLSearchParams, name: string): string {
	const value = params.get(name);
	if (!value) {
		throw new Error(`${name} must be specified as a query parameter`);
	}
	return value;
}

async function handleOpen(ctx: UriRouteContext): Promise<void> {
	const { params, serviceContainer, deploymentManager, commands } = ctx;

	const owner = getRequiredParam(params, "owner");
	const workspace = getRequiredParam(params, "workspace");
	const agent = params.get("agent");
	const folder = params.get("folder");
	const openRecent =
		params.has("openRecent") &&
		(!params.get("openRecent") || params.get("openRecent") === "true");

	await setupDeployment(params, serviceContainer, deploymentManager);

	await commands.open(
		owner,
		workspace,
		agent ?? undefined,
		folder ?? undefined,
		openRecent,
	);
}

async function handleOpenDevContainer(ctx: UriRouteContext): Promise<void> {
	const { params, serviceContainer, deploymentManager, commands } = ctx;

	const owner = getRequiredParam(params, "owner");
	const workspace = getRequiredParam(params, "workspace");
	const agent = getRequiredParam(params, "agent");
	const devContainerName = getRequiredParam(params, "devContainerName");
	const devContainerFolder = getRequiredParam(params, "devContainerFolder");
	const localWorkspaceFolder = params.get("localWorkspaceFolder");
	const localConfigFile = params.get("localConfigFile");

	if (localConfigFile && !localWorkspaceFolder) {
		throw new Error(
			"localWorkspaceFolder must be specified as a query parameter if localConfigFile is provided",
		);
	}

	await setupDeployment(params, serviceContainer, deploymentManager);

	await commands.openDevContainer(
		owner,
		workspace,
		agent,
		devContainerName,
		devContainerFolder,
		localWorkspaceFolder ?? "",
		localConfigFile ?? "",
	);
}

/**
 * Sets up deployment from URI parameters. Handles URL prompting, client setup,
 * and token storage. Throws if user cancels URL input or login fails.
 */
async function setupDeployment(
	params: URLSearchParams,
	serviceContainer: ServiceContainer,
	deploymentManager: DeploymentManager,
): Promise<void> {
	const secretsManager = serviceContainer.getSecretsManager();
	const mementoManager = serviceContainer.getMementoManager();
	const loginCoordinator = serviceContainer.getLoginCoordinator();

	const currentDeployment = await secretsManager.getCurrentDeployment();

	// We are not guaranteed that the URL we currently have is for the URL
	// this workspace belongs to, or that we even have a URL at all (the
	// queries will default to localhost) so ask for it if missing.
	// Pre-populate in case we do have the right URL so the user can just
	// hit enter and move on.
	const url = await maybeAskUrl(
		mementoManager,
		params.get("url"),
		currentDeployment?.url,
	);
	if (!url) {
		throw new Error("url must be provided or specified as a query parameter");
	}

	const safeHostname = toSafeHost(url);

	const token: string | undefined = params.get("token") ?? undefined;
	const result = await loginCoordinator.ensureLoggedIn({
		safeHostname,
		url,
		token,
	});

	if (!result.success) {
		throw new Error("Failed to login to deployment from URI");
	}

	await deploymentManager.setDeployment({
		safeHostname,
		url,
		token: result.token,
		user: result.user,
	});
}
