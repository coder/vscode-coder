import { describe, expect, it } from "vitest";

import { refreshCertificates } from "@/api/certificateRefresh";
import { ClientCertificateError } from "@/error/clientCertificateError";

import { createMockLogger } from "../../mocks/testHelpers";
import { exitCommand, printCommand } from "../../utils/platform";

const logger = createMockLogger();

describe("ClientCertificateError.isExpiredError", () => {
	it("should return true for SSLV3_ALERT_CERTIFICATE_EXPIRED", () => {
		const error = new Error(
			"write EPROTO 18468360202752:error:10000415:SSL routines:OPENSSL_internal:SSLV3_ALERT_CERTIFICATE_EXPIRED:../../third_party/boringssl/src/ssl/tls_record.cc:486:SSL alert number 45",
		);
		expect(ClientCertificateError.isExpiredError(error)).toBe(true);
	});

	it("should return true for certificate_expired", () => {
		const error = new Error("SSL error: certificate_expired");
		expect(ClientCertificateError.isExpiredError(error)).toBe(true);
	});

	it("should return true for SSL alert number 45", () => {
		const error = new Error("SSL handshake failed: SSL alert number 45");
		expect(ClientCertificateError.isExpiredError(error)).toBe(true);
	});

	it("should return false for other SSL errors", () => {
		const error = new Error("SSL error: UNABLE_TO_VERIFY_LEAF_SIGNATURE");
		expect(ClientCertificateError.isExpiredError(error)).toBe(false);
	});

	it("should return false for non-SSL errors", () => {
		const error = new Error("Connection refused");
		expect(ClientCertificateError.isExpiredError(error)).toBe(false);
	});

	it("should handle error with nested error.message", () => {
		const error = { error: { message: "SSLV3_ALERT_CERTIFICATE_EXPIRED" } };
		expect(ClientCertificateError.isExpiredError(error)).toBe(true);
	});

	it("should handle null and undefined", () => {
		expect(ClientCertificateError.isExpiredError(null)).toBe(false);
		expect(ClientCertificateError.isExpiredError(undefined)).toBe(false);
	});

	it("should handle string errors", () => {
		expect(
			ClientCertificateError.isExpiredError("SSLV3_ALERT_CERTIFICATE_EXPIRED"),
		).toBe(true);
		expect(ClientCertificateError.isExpiredError("some other error")).toBe(
			false,
		);
	});
});

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
