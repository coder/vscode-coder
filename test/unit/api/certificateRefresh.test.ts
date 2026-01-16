import { describe, expect, it } from "vitest";

import { refreshCertificates } from "@/api/certificateRefresh";

import { createMockLogger } from "../../mocks/testHelpers";
import { exitCommand, printCommand } from "../../utils/platform";

const logger = createMockLogger();

describe("refreshCertificates", () => {
	it("should return true on successful command", async () => {
		const result = await refreshCertificates(
			printCommand("certificates refreshed"),
			logger,
		);
		expect(result).toBe(true);
	});

	it("should return false on command failure", async () => {
		const result = await refreshCertificates(exitCommand(1), logger);
		expect(result).toBe(false);
	});

	it("should return false on non-existent command", async () => {
		const result = await refreshCertificates(
			"nonexistent-command-that-should-not-exist",
			logger,
		);
		expect(result).toBe(false);
	});
});
