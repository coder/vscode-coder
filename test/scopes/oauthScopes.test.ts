import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_OAUTH_SCOPES } from "@/oauth/constants";

import { setUpDeployment, type Deployment } from "./deployment";
import { cliProbes, knownGaps, probes } from "./probes";

/** A fresh Coder deployment, e.g. from compose.yaml; the suite is skipped without one. */
const url = process.env.CODER_URL ?? "";

describe.skipIf(!url)("OAuth scopes", () => {
	let deployment: Deployment;

	beforeAll(async () => {
		deployment = await setUpDeployment(url, DEFAULT_OAUTH_SCOPES);
	});

	it.each(Object.entries({ ...probes, ...cliProbes }))(
		"%s",
		async (_name, probe) => {
			await probe(deployment);
		},
	);

	it.each(Object.entries(knownGaps))(
		"%s (known gap)",
		async (_name, { probe, error }) => {
			const passed = new Error("The gap is fixed: move this probe to `probes`");
			await expect(
				probe(deployment).then(() => Promise.reject(passed)),
			).rejects.toThrow(error);
		},
	);
});
