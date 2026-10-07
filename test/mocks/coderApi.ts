import { onTestFinished } from "vitest";

import { CoderApi } from "@/api/coderApi";

import { createMockLogger } from "./testHelpers";

/** Real `CoderApi` with `overrides` applied; unstubbed methods hit `baseUrl`. */
export function createTestCoderApi<T extends Partial<CoderApi>>(
	options: { baseUrl?: string; token?: string; overrides?: T } = {},
): CoderApi & T {
	const client = CoderApi.create(
		options.baseUrl ?? "",
		options.token,
		createMockLogger(),
	);
	onTestFinished(() => client.dispose());
	return Object.assign(client, options.overrides);
}
