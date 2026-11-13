import { vi } from "vitest";
import * as vscode from "vscode";

import { toSafeHost } from "@/common/url";
import { OAuthAuthorizer } from "@/oauth/authorizer";
import { OAuthCallback } from "@/oauth/oauthCallback";
import { OAuthSessionManager } from "@/oauth/sessionManager";
import { buildOAuthTokenData } from "@/oauth/tokens";
import { MementoManager } from "@/storage/mementoManager";
import { SecretsManager } from "@/storage/secretsManager";

import {
	createMockLogger,
	createMockServiceContainer,
	InMemoryMemento,
	InMemorySecretStorage,
	MockCancellationToken,
	MockProgress,
} from "../../mocks/testHelpers";

import type { Api } from "coder/site/src/api/api";

export interface OAuthSession {
	/** The access token after one refresh, as in a long session. */
	token: string;
	/** Scopes the extension put in its authorize URL. */
	requestedScopes: string;
	/** Scopes the server granted at login and at refresh. */
	grantedScopes: { login: string; refresh: string };
}

/**
 * Runs the extension's OAuth login and one token refresh, consenting as
 * `member` in place of the browser.
 */
export async function signInWithOAuth(
	url: string,
	member: Api,
): Promise<OAuthSession> {
	const secrets = new InMemorySecretStorage();
	const logger = createMockLogger();
	const callback = new OAuthCallback(secrets, logger);
	const secretsManager = new SecretsManager(
		secrets,
		new MementoManager(new InMemoryMemento()),
		logger,
	);
	const authorizer = new OAuthAuthorizer(
		secretsManager,
		callback,
		logger,
		"coder.coder-remote",
	);
	let requestedScopes = "";
	// Stands in for the browser: the consent page's Allow button posts the
	// authorize URL back, and the server redirects to the extension's callback.
	vi.mocked(vscode.env.openExternal).mockImplementationOnce(async (uri) => {
		const authorize = uri.toString();
		requestedScopes = new URL(authorize).searchParams.get("scope") ?? "";
		const consent = await member.getAxiosInstance().post(authorize, undefined, {
			maxRedirects: 0,
			validateStatus: (status) => status === 302,
		});
		const { searchParams } = new URL(String(consent.headers.location));
		const error = searchParams.get("error");
		await callback.send({
			state: searchParams.get("state") ?? "",
			code: searchParams.get("code"),
			error:
				error &&
				[error, searchParams.get("error_description")]
					.filter(Boolean)
					.join(": "),
		});
		return true;
	});
	const deployment = { url, safeHostname: toSafeHost(url) };
	const login = await authorizer
		.login(deployment, new MockProgress(), new MockCancellationToken())
		.finally(() => authorizer.dispose());
	// Store the login as the extension does, so the refresh can read it.
	await secretsManager.setSessionAuth(deployment.safeHostname, {
		url,
		token: login.tokenResponse.access_token,
		oauth: buildOAuthTokenData(login.tokenResponse, login.registration),
	});
	const sessions = OAuthSessionManager.create(
		deployment,
		createMockServiceContainer({ secretsManager, logger }),
	);
	const refresh = await sessions
		.refreshToken()
		.finally(() => sessions.dispose());
	return {
		token: refresh.access_token,
		requestedScopes,
		grantedScopes: {
			login: login.tokenResponse.scope ?? "",
			refresh: refresh.scope ?? "",
		},
	};
}
