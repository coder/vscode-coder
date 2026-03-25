import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MementoManager } from "@/core/mementoManager";

import { InMemoryMemento } from "../../mocks/testHelpers";

describe("MementoManager", () => {
	let memento: InMemoryMemento;
	let mementoManager: MementoManager;

	beforeEach(() => {
		vi.useFakeTimers();
		memento = new InMemoryMemento();
		mementoManager = new MementoManager(memento);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("addToUrlHistory", () => {
		it("should add URL to history", async () => {
			await mementoManager.addToUrlHistory("https://coder.example.com");

			expect(memento.get("urlHistory")).toEqual(["https://coder.example.com"]);
		});

		it("should not update history for falsy values", async () => {
			await mementoManager.addToUrlHistory("");
			expect(memento.get("urlHistory")).toBeUndefined();
		});

		it("should deduplicate URLs in history", async () => {
			await mementoManager.addToUrlHistory("url1");
			await mementoManager.addToUrlHistory("url2");
			await mementoManager.addToUrlHistory("url1"); // Re-add first URL

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

		it("should treat legacy bare values as expired", async () => {
			await memento.update("firstConnect", true);
			expect(await mementoManager.getAndClearFirstConnect()).toBe(false);
		});

		it("should expire after 5 minutes", async () => {
			await mementoManager.setFirstConnect();
			vi.advanceTimersByTime(5 * 60 * 1000 + 1);
			expect(await mementoManager.getAndClearFirstConnect()).toBe(false);
		});
	});

	describe("pendingChatId", () => {
		it("should store, retrieve, and clear in one call", async () => {
			await mementoManager.setPendingChatId("chat-123");

			expect(await mementoManager.getAndClearPendingChatId()).toBe("chat-123");
			expect(await mementoManager.getAndClearPendingChatId()).toBeUndefined();
		});

		it("should return undefined when nothing is set", async () => {
			expect(await mementoManager.getAndClearPendingChatId()).toBeUndefined();
		});

		it("should support explicit clear", async () => {
			await mementoManager.setPendingChatId("chat-123");
			await mementoManager.clearPendingChatId();
			expect(await mementoManager.getAndClearPendingChatId()).toBeUndefined();
		});

		it("should expire after 5 minutes", async () => {
			await mementoManager.setPendingChatId("chat-123");
			vi.advanceTimersByTime(5 * 60 * 1000 + 1);
			expect(await mementoManager.getAndClearPendingChatId()).toBeUndefined();
		});

		it("should treat legacy bare values as expired", async () => {
			await memento.update("pendingChatId", "bare-chat-id");
			expect(await mementoManager.getAndClearPendingChatId()).toBeUndefined();
		});
	});
});
