import { describe, expect, it } from "vitest";

import { MementoManager } from "@/storage/mementoManager";
import { maybeAskUrl } from "@/ui/prompts";

import {
	INVALID_DEPLOYMENT_URLS,
	InMemoryMemento,
} from "../../mocks/testHelpers";

describe("maybeAskUrl", () => {
	const mementoManager = new MementoManager(new InMemoryMemento());

	it.each([
		["coder.example.com/", "https://coder.example.com"],
		["https://coder.example.com/base/", "https://coder.example.com/base"],
		["https://bücher.example", "https://xn--bcher-kva.example"],
	])("normalizes %j to %j", async (input, expected) => {
		await expect(maybeAskUrl(mementoManager, input)).resolves.toBe(expected);
	});

	it.each([...INVALID_DEPLOYMENT_URLS, "host/'; id; '"])(
		"rejects %j before sign-in",
		async (url) => {
			await expect(maybeAskUrl(mementoManager, url)).rejects.toThrow(
				/Invalid URL/,
			);
		},
	);
});
