import { beforeEach, describe, expect, it } from "vitest";

import { MementoManager } from "@/core/mementoManager";

import { InMemoryMemento } from "../../mocks/testHelpers";

describe("MementoManager", () => {
	let memento: InMemoryMemento;
	let mementoManager: MementoManager;

	beforeEach(() => {
		memento = new InMemoryMemento();
		mementoManager = new MementoManager(memento);
	});

	describe("setUrl", () => {
		it("should store URL and add to history", async () => {
			await mementoManager.setUrl("https://coder.example.com");

			expect(mementoManager.getUrl()).toBe("https://coder.example.com");
			expect(memento.get("urlHistory")).toEqual(["https://coder.example.com"]);
		});

		it("should not update history for falsy values", async () => {
			await mementoManager.setUrl(undefined);
			expect(mementoManager.getUrl()).toBeUndefined();
			expect(memento.get("urlHistory")).toBeUndefined();

			await mementoManager.setUrl("");
			expect(mementoManager.getUrl()).toBe("");
			expect(memento.get("urlHistory")).toBeUndefined();
		});

		it("should deduplicate URLs in history", async () => {
			await mementoManager.setUrl("url1");
			await mementoManager.setUrl("url2");
			await mementoManager.setUrl("url1"); // Re-add first URL

			expect(memento.get("urlHistory")).toEqual(["url2", "url1"]);
		});
	});

	describe("withUrlHistory", () => {
		it("should append URLs and remove duplicates", async () => {
			await memento.update("urlHistory", ["existing1", "existing2"]);

			const result = mementoManager.withUrlHistory("existing2", "new1");

			expect(result).toEqual(["existing1", "existing2", "new1"]);
		});

		it("should limit to 10 URLs", async () => {
			const urls = Array.from({ length: 10 }, (_, i) => `url${i}`);
			await memento.update("urlHistory", urls);

			const result = mementoManager.withUrlHistory("url20");

			expect(result).toHaveLength(10);
			expect(result[0]).toBe("url1");
			expect(result[9]).toBe("url20");
		});

		it("should handle non-array storage gracefully", async () => {
			await memento.update("urlHistory", "not-an-array");
			const result = mementoManager.withUrlHistory("url1");
			expect(result).toEqual(["url1"]);
		});
	});

	describe("firstConnect", () => {
		it("should return true only once", async () => {
			await mementoManager.setFirstConnect();

			expect(await mementoManager.getAndClearFirstConnect()).toBe(true);
			expect(await mementoManager.getAndClearFirstConnect()).toBe(false);
		});

		it("should return false for non-boolean values", async () => {
			await memento.update("firstConnect", "truthy-string");
			expect(await mementoManager.getAndClearFirstConnect()).toBe(false);
		});
	});
});
