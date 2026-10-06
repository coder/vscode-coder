import { beforeAll, describe, expect, it } from "vitest";

import {
	DEFAULT_OAUTH_SCOPES,
	IF_SUPPORTED_OAUTH_SCOPES,
} from "@/oauth/constants";

import { setUpDeployment, type Deployment } from "./deployment";
import { cliProbes, probes } from "./probes";

import type { OAuth2AuthorizationServerMetadata } from "coder/site/src/api/typesGenerated";

/** A throwaway deployment; the suite takes it over. */
const url = process.env.CODER_SCOPES_TEST_URL;

describe("OAuth scopes", () => {
	let deployment: Deployment;
	/** What the extension requests from this server. */
	let requested: string[];

	beforeAll(async () => {
		if (!url) {
			throw new Error(
				"Set CODER_SCOPES_TEST_URL to a fresh deployment, such as test/scopes/compose.yaml",
			);
		}
		// Set in Coder workspaces; the CLI would use it over the probe's token.
		delete process.env.CODER_SESSION_TOKEN;
		deployment = await setUpDeployment(url);
		const { data } = await deployment.admin
			.getAxiosInstance()
			.get<OAuth2AuthorizationServerMetadata>(
				"/.well-known/oauth-authorization-server",
			);
		requested = [
			...DEFAULT_OAUTH_SCOPES.split(" "),
			...IF_SUPPORTED_OAUTH_SCOPES.filter((scope) =>
				data.scopes_supported?.includes(scope),
			),
		];
	});

	it.each(["login", "refresh"] as const)(
		"grants exactly the requested scopes at %s",
		(grant) => {
			expect(deployment.grantedScopes[grant].split(" ").sort()).toEqual(
				[...requested].sort(),
			);
		},
	);

	it.each(Object.entries({ ...probes, ...cliProbes }))(
		"%s",
		async (_name, probe) => {
			await probe(deployment);
		},
	);
});
