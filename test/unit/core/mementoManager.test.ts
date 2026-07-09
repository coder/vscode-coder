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

	describe("surfaced banners", () => {
		it("stores surfaced banner keys by safe hostname", async () => {
			await mementoManager.addSurfacedBanners("example.com", ["one", "two"]);
			await mementoManager.addSurfacedBanners("other.com", ["three"]);

			expect(mementoManager.getSurfacedBanners("example.com")).toEqual([
				"one",
				"two",
			]);
			expect(mementoManager.getSurfacedBanners("other.com")).toEqual(["three"]);
		});

		it("merges new banner keys into the surfaced set", async () => {
			await mementoManager.addSurfacedBanners("example.com", ["one"]);
			await mementoManager.addSurfacedBanners("example.com", ["one", "two"]);

			expect(mementoManager.getSurfacedBanners("example.com")).toEqual([
				"one",
				"two",
			]);
		});

		it("ignores corrupted surfaced banner storage", async () => {
			await memento.update("coder.surfacedBanners.example.com", {
				bad: true,
			});

			expect(mementoManager.getSurfacedBanners("example.com")).toEqual([]);
		});
	});

	describe("deployment data", () => {
		it("clears access timestamp and surfaced banners together", async () => {
			await mementoManager.updateDeploymentAccess("example.com");
			await mementoManager.addSurfacedBanners("example.com", ["one"]);
			expect(mementoManager.getDeploymentAccess("example.com")).toBeDefined();

			await mementoManager.clearDeploymentData("example.com");

			expect(mementoManager.getDeploymentAccess("example.com")).toBeUndefined();
			expect(mementoManager.getSurfacedBanners("example.com")).toEqual([]);
		});
	});

	describe("startupMode", () => {
		it("should return the set mode and clear after read", async () => {
			await mementoManager.setStartupMode("start");
			expect(await mementoManager.getAndClearStartupMode()).toBe("start");
			expect(await mementoManager.getAndClearStartupMode()).toBe("none");
		});

		it("should return 'none' when nothing is set", async () => {
			expect(await mementoManager.getAndClearStartupMode()).toBe("none");
		});

		it("should support 'update' mode", async () => {
			await mementoManager.setStartupMode("update");
			expect(await mementoManager.getAndClearStartupMode()).toBe("update");
		});

		it("should treat legacy bare values as expired", async () => {
			await memento.update("startupMode", "start");
			expect(await mementoManager.getAndClearStartupMode()).toBe("none");
		});

		it("should expire after 5 minutes", async () => {
			await mementoManager.setStartupMode("update");
			vi.advanceTimersByTime(5 * 60 * 1000 + 1);
			expect(await mementoManager.getAndClearStartupMode()).toBe("none");
		});
	});
});
