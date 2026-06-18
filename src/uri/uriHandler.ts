import * as vscode from "vscode";

import { errToStr } from "../api/api-helper";
import { AuthTelemetry } from "../instrumentation/auth";
import { CALLBACK_PATH } from "../oauth/utils";
import { maybeAskUrl } from "../promptUtils";
import { toSafeHost } from "../util/uri";
import { vscodeProposed } from "../vscodeProposed";

import type { Commands } from "../commands";
import type { ServiceContainer } from "../core/container";
import type { DeploymentManager } from "../deployment/deploymentManager";

interface UriHandlerDeps {
	serviceContainer: ServiceContainer;
	deploymentManager: Pick<DeploymentManager, "setDeployment">;
	commands: Pick<Commands, "open" | "openDevContainer">;
}

interface UriRouteContext extends UriHandlerDeps {
	params: URLSearchParams;
}

type UriRouteHandler = (ctx: UriRouteContext) => Promise<void>;
type CoderUriRoute = "open" | "openDevContainer";

const routes: Readonly<Record<string, UriRouteHandler>> = {
	"/open": handleOpen,
	"/openDevContainer": handleOpenDevContainer,
	[CALLBACK_PATH]: handleOAuthCallback,
};

/**
 * Registers the URI handler for `{vscode.env.uriScheme}://coder.coder-remote`... URIs.
 */
export function registerUriHandler(deps: UriHandlerDeps): vscode.Disposable {
	const output = deps.serviceContainer.getLogger();

	return vscode.window.registerUriHandler({
		handleUri: async (uri) => {
			try {
				const handler = routes[uri.path];
				if (!handler) {
					throw new Error(`Unknown path ${uri.path}`);
				}
				await handler({
					...deps,
					params: new URLSearchParams(uri.query),
				});
			} catch (error) {
				const message = errToStr(error, "No error message was provided");
				output.warn("Failed to handle URI", {
					...summarizeUri(uri),
					error: message,
				});
				vscodeProposed.window.showErrorMessage("Failed to handle URI", {
					detail: message,
					modal: true,
					useCustom: true,
				});
			}
		},
	});
}

function getRequiredParam(params: URLSearchParams, name: string): string {
	const value = params.get(name);
	if (!value) {
		throw new Error(`${name} must be specified as a query parameter`);
	}
	return value;
}

function summarizeUri(uri: vscode.Uri): Record<string, string | boolean> {
	const params = new URLSearchParams(uri.query);
	return {
		path: uri.path,
		hasOwner: params.has("owner"),
		hasWorkspace: params.has("workspace"),
		hasAgent: params.has("agent"),
		hasToken: params.has("token"),
	};
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

	await setupDeployment("open", params, serviceContainer, deploymentManager);

	await commands.open({
		workspaceOwner: owner,
		workspaceName: workspace,
		agentName: agent ?? undefined,
		folderPath: folder ?? undefined,
		openRecent,
		source: "uri",
		useDefaultDirectory: false,
	});
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

	await setupDeployment(
		"openDevContainer",
		params,
		serviceContainer,
		deploymentManager,
	);

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
	route: CoderUriRoute,
	params: URLSearchParams,
	serviceContainer: ServiceContainer,
	deploymentManager: Pick<DeploymentManager, "setDeployment">,
): Promise<void> {
	const secretsManager = serviceContainer.getSecretsManager();
	const mementoManager = serviceContainer.getMementoManager();
	const loginCoordinator = serviceContainer.getLoginCoordinator();
	const authTelemetry = new AuthTelemetry(
		serviceContainer.getTelemetryService(),
	);

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
	const owner = params.get("owner") ?? "";
	const workspace = params.get("workspace") ?? "";
	serviceContainer.getLogger().info("Handling Coder URI", {
		route,
		safeHostname,
		workspace: owner && workspace ? `${owner}/${workspace}` : "",
		agent: params.get("agent") ?? "(unspecified)",
	});

	const token: string | undefined = params.get("token") ?? undefined;
	const result = await authTelemetry.traceLogin("uri", () =>
		loginCoordinator.ensureLoggedIn({ safeHostname, url, token }),
	);

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

async function handleOAuthCallback(ctx: UriRouteContext): Promise<void> {
	const { params, serviceContainer } = ctx;
	const logger = serviceContainer.getLogger();
	const oauthCallback = serviceContainer.getOAuthCallback();

	const code = params.get("code");
	const state = params.get("state");
	const error = params.get("error");

	if (!state) {
		logger.warn("Received OAuth callback with no state parameter");
		return;
	}

	try {
		await oauthCallback.send({ state, code, error });
		logger.debug("OAuth callback processed successfully");
	} catch (err) {
		logger.error("Failed to process OAuth callback:", err);
	}
}
