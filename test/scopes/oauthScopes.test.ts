import { beforeAll, describe, expect, it } from "vitest";

import { LocalProxySettings } from "@/settings/proxy";

import { MockConfigurationProvider } from "../mocks/testHelpers";

import { apiProbes, cliProbes } from "./probes";
import { setUpDeployment, type Deployment } from "./support/deployment";

describe("OAuth scopes", () => {
	let deployment: Deployment;

	// The extension creates these on activation, which the suite doesn't run.
	beforeAll(() => {
		new MockConfigurationProvider();
		const proxySettings = LocalProxySettings.initialize();
		return () => proxySettings.dispose();
	});

	beforeAll(async () => {
		const url = process.env.CODER_SCOPES_TEST_URL;
		if (!url) {
			throw new Error(
				"Set CODER_SCOPES_TEST_URL to a fresh deployment; see docs/TESTING.md#oauth-scope-tests",
			);
		}
		deployment = await setUpDeployment(url);
	});

	it.each(["login", "refresh"] as const)(
		"grants exactly the requested scopes at %s",
		(grant) => {
			const sorted = (scopes: string) => scopes.split(" ").sort();
			expect(sorted(deployment.grantedScopes[grant])).toEqual(
				sorted(deployment.requestedScopes),
			);
		},
	);

	describe("API probes", () => {
		it.each(Object.entries(apiProbes))("%s", async (_name, probe) => {
			await probe(deployment);
		});
	});

	describe("CLI probes", () => {
		it.each(Object.entries(cliProbes))("%s", async (_name, probe) => {
			await probe(deployment);
		});
	});
});
