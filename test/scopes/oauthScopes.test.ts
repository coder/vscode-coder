import { beforeAll, describe, expect, it } from "vitest";

import {
	DEFAULT_OAUTH_SCOPES,
	IF_SUPPORTED_OAUTH_SCOPES,
} from "@/oauth/constants";
import { hasRequiredScopes } from "@/oauth/tokens";

import { setUpDeployment, withScopes, type Deployment } from "./deployment";
import { cliProbes, knownGaps, probes, scopeConsumers } from "./probes";

/** A throwaway deployment; the suite takes it over. */
const url = process.env.CODER_SCOPES_TEST_URL;

const REQUESTED_SCOPES = [
	...DEFAULT_OAUTH_SCOPES.split(" "),
	...IF_SUPPORTED_OAUTH_SCOPES,
];

const ALL_PROBES = { ...probes, ...cliProbes };

describe("OAuth scopes", () => {
	let deployment: Deployment;

	beforeAll(async () => {
		if (!url) {
			throw new Error(
				"Set CODER_SCOPES_TEST_URL to a fresh deployment, such as test/scopes/compose.yaml",
			);
		}
		// Set in Coder workspaces; the CLI would use it over the probe's token.
		delete process.env.CODER_SESSION_TOKEN;
		deployment = await setUpDeployment(url);
	});

	it("grants exactly the scopes the extension requests over OAuth", () => {
		expect(deployment.grantedScope.split(" ").sort()).toEqual(
			[...REQUESTED_SCOPES].sort(),
		);
		expect(hasRequiredScopes(deployment.grantedScope)).toBe(true);
	});

	it.each(Object.entries(ALL_PROBES))("%s", async (_name, probe) => {
		await probe(deployment);
	});

	it.each(Object.entries(knownGaps))(
		"%s (known gap)",
		async (_name, { probe, error }) => {
			const passed = new Error(
				"The gap changed: request any scope that now grants it, then move this probe to `probes` or `cliProbes`",
			);
			await expect(
				probe(deployment).then(() => Promise.reject(passed)),
			).rejects.toThrow(error);
		},
	);

	it("names a consumer for every requested scope", () => {
		expect(
			Object.keys(scopeConsumers).sort(),
			"Name a probe that fails without each scope, or the reason none can, in `scopeConsumers` in test/scopes/probes.ts",
		).toEqual([...REQUESTED_SCOPES].sort());
	});

	it.each(
		Object.entries(scopeConsumers).flatMap(([scope, consumer]) =>
			"probeName" in consumer
				? [[scope, consumer.probeName, consumer.error]]
				: [],
		),
	)("%s is needed by %s", async (scope, name, error) => {
		const probe = ALL_PROBES[name];
		expect(probe, `${name} is not a probe`).toBeDefined();
		const without = await withScopes(
			deployment,
			REQUESTED_SCOPES.filter((requested) => requested !== scope),
		);
		await expect(probe(without)).rejects.toThrow(error);
	});
});
