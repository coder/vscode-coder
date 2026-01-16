import { describe, expect, it } from "vitest";

import { execCommand } from "@/command/exec";

import { createMockLogger } from "../../mocks/testHelpers";
import {
	exitCommand,
	printCommand,
	printEnvCommand,
} from "../../utils/platform";

const logger = createMockLogger();

describe("execCommand", () => {
	it("should return success with stdout on successful command", async () => {
		const result = await execCommand(printCommand("hello"), logger, {
			title: "Test",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.stdout).toContain("hello");
		}
	});

	it("should return failure with exit code on command failure", async () => {
		const result = await execCommand(exitCommand(42), logger, {
			title: "Test",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.exitCode).toBe(42);
		}
	});

	it("should return failure for non-existent command", async () => {
		const result = await execCommand("nonexistent-cmd-12345", logger, {
			title: "Test",
		});
		expect(result.success).toBe(false);
	});

	it("should pass environment variables to command", async () => {
		const result = await execCommand(
			printEnvCommand("TEST_VAR", "TEST_VAR"),
			logger,
			{
				title: "Test",
				env: { ...process.env, TEST_VAR: "test_value" },
			},
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.stdout).toContain("test_value");
		}
	});

	it("should use default title when not provided", async () => {
		const result = await execCommand(printCommand("test"), logger);
		expect(result.success).toBe(true);
	});
});
