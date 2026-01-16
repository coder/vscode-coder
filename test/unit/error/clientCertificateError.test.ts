import { describe, expect, it } from "vitest";

import {
	ClientCertificateError,
	CLIENT_CERT_ALERT,
	CLIENT_CERT_MESSAGES,
} from "@/error/clientCertificateError";

type AlertName = keyof typeof CLIENT_CERT_ALERT;
type AlertTestCase = [AlertName, string];
type LowercaseTestCase = [string, CLIENT_CERT_ALERT];
type AlertNumberTestCase = [number, CLIENT_CERT_ALERT];

describe("ClientCertificateError.fromError", () => {
	describe("SSLV3_ALERT_* patterns", () => {
		it.each<AlertTestCase>([
			["BAD_CERTIFICATE", "SSLV3_ALERT_BAD_CERTIFICATE:SSL alert number 42"],
			[
				"UNSUPPORTED_CERTIFICATE",
				"SSLV3_ALERT_UNSUPPORTED_CERTIFICATE:SSL alert number 43",
			],
			[
				"CERTIFICATE_REVOKED",
				"SSLV3_ALERT_CERTIFICATE_REVOKED:SSL alert number 44",
			],
			[
				"CERTIFICATE_EXPIRED",
				"write EPROTO 18468360202752:error:10000415:SSL routines:OPENSSL_internal:SSLV3_ALERT_CERTIFICATE_EXPIRED:../../third_party/boringssl/src/ssl/tls_record.cc:486:SSL alert number 45",
			],
			[
				"CERTIFICATE_UNKNOWN",
				"SSLV3_ALERT_CERTIFICATE_UNKNOWN:SSL alert number 46",
			],
			["UNKNOWN_CA", "SSLV3_ALERT_UNKNOWN_CA:SSL alert number 48"],
			["ACCESS_DENIED", "SSLV3_ALERT_ACCESS_DENIED:SSL alert number 49"],
		])("should detect %s", (alertName, message) => {
			const certError = ClientCertificateError.fromError(new Error(message));
			expect(certError).toBeDefined();
			expect(certError!.alertCode).toBe(CLIENT_CERT_ALERT[alertName]);
		});
	});

	describe("lowercase patterns", () => {
		it.each<LowercaseTestCase>([
			["certificate_expired", CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED],
			["bad_certificate", CLIENT_CERT_ALERT.BAD_CERTIFICATE],
			["unknown_ca", CLIENT_CERT_ALERT.UNKNOWN_CA],
		])("should detect %s", (pattern, expectedCode) => {
			const certError = ClientCertificateError.fromError(
				new Error(`SSL error: ${pattern}`),
			);
			expect(certError).toBeDefined();
			expect(certError!.alertCode).toBe(expectedCode);
		});
	});

	describe("SSL alert number fallback", () => {
		it.each<AlertNumberTestCase>([
			[45, CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED],
			[42, CLIENT_CERT_ALERT.BAD_CERTIFICATE],
			[48, CLIENT_CERT_ALERT.UNKNOWN_CA],
		])("should detect alert number %i", (alertNumber, expectedCode) => {
			const certError = ClientCertificateError.fromError(
				new Error(`SSL handshake failed: SSL alert number ${alertNumber}`),
			);
			expect(certError).toBeDefined();
			expect(certError!.alertCode).toBe(expectedCode);
		});

		it("should return undefined for unknown alert numbers", () => {
			const certError = ClientCertificateError.fromError(
				new Error("SSL handshake failed: SSL alert number 99"),
			);
			expect(certError).toBeUndefined();
		});
	});

	describe("error types", () => {
		it("should handle plain Error objects", () => {
			const certError = ClientCertificateError.fromError(
				new Error("SSLV3_ALERT_CERTIFICATE_EXPIRED"),
			);
			expect(certError).toBeDefined();
			expect(certError!.alertCode).toBe(CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED);
		});

		it("should handle string errors", () => {
			const certError = ClientCertificateError.fromError(
				"SSLV3_ALERT_CERTIFICATE_EXPIRED",
			);
			expect(certError).toBeDefined();
			expect(certError!.alertCode).toBe(CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED);

			expect(
				ClientCertificateError.fromError("some other error"),
			).toBeUndefined();
		});

		it("should handle errors with code property", () => {
			const certError = ClientCertificateError.fromError({
				code: "ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED",
				message: "certificate has expired",
			});
			expect(certError).toBeDefined();
			expect(certError!.alertCode).toBe(CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED);
		});

		it.each([null, undefined])("should return undefined for %s", (value) => {
			expect(ClientCertificateError.fromError(value)).toBeUndefined();
		});

		it.each([
			["non-SSL errors", "Connection refused"],
			["other SSL errors", "SSL error: UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
		])("should return undefined for %s", (_desc, message) => {
			expect(
				ClientCertificateError.fromError(new Error(message)),
			).toBeUndefined();
		});
	});
});

describe("ClientCertificateError.isRefreshable", () => {
	it.each<AlertTestCase>([
		["CERTIFICATE_EXPIRED", "SSLV3_ALERT_CERTIFICATE_EXPIRED"],
		["CERTIFICATE_REVOKED", "SSLV3_ALERT_CERTIFICATE_REVOKED"],
		["BAD_CERTIFICATE", "SSLV3_ALERT_BAD_CERTIFICATE"],
		["CERTIFICATE_UNKNOWN", "SSLV3_ALERT_CERTIFICATE_UNKNOWN"],
	])("should return true for refreshable alert %s", (_name, msg) => {
		const error = new Error(msg);
		expect(ClientCertificateError.isRefreshable(error)).toBe(true);
	});

	it.each<AlertTestCase>([
		["UNKNOWN_CA", "SSLV3_ALERT_UNKNOWN_CA"],
		["ACCESS_DENIED", "SSLV3_ALERT_ACCESS_DENIED"],
		["UNSUPPORTED_CERTIFICATE", "SSLV3_ALERT_UNSUPPORTED_CERTIFICATE"],
	])("should return false for non-refreshable alert %s", (_name, msg) => {
		const error = new Error(msg);
		expect(ClientCertificateError.isRefreshable(error)).toBe(false);
	});

	it("should return false for non-certificate errors", () => {
		expect(
			ClientCertificateError.isRefreshable(new Error("Connection refused")),
		).toBe(false);
		expect(ClientCertificateError.isRefreshable(null)).toBe(false);
		expect(ClientCertificateError.isRefreshable(undefined)).toBe(false);
	});
});

describe("ClientCertificateError properties", () => {
	it("should be refreshable with guidance for refreshable errors", () => {
		const certError = ClientCertificateError.fromError(
			new Error("SSLV3_ALERT_CERTIFICATE_EXPIRED"),
		);
		expect(certError).toBeDefined();
		expect(certError!.isRefreshable).toBe(true);
		expect(certError!.alertCode).toBe(CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED);
		expect(certError!.detail).toContain(
			CLIENT_CERT_MESSAGES[CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED],
		);
		expect(certError!.detail).toContain("Try refreshing your credentials");
	});

	it("should not be refreshable for configuration errors", () => {
		const certError = ClientCertificateError.fromError(
			new Error("SSLV3_ALERT_UNKNOWN_CA"),
		);
		expect(certError).toBeDefined();
		expect(certError!.isRefreshable).toBe(false);
		expect(certError!.detail).toContain(
			CLIENT_CERT_MESSAGES[CLIENT_CERT_ALERT.UNKNOWN_CA],
		);
		expect(certError!.detail).toContain("cannot be resolved by refreshing");
	});
});
