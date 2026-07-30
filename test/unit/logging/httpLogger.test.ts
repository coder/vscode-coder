import { AxiosError, type AxiosHeaders, type AxiosResponse } from "axios";
import { describe, expect, it, vi } from "vitest";

import {
	createRequestMeta,
	logError,
	logRequest,
	logResponse,
} from "@/logging/httpLogger";
import {
	HttpClientLogLevel,
	type RequestConfigWithMeta,
} from "@/logging/types";

import { createMockLogger } from "../../mocks/testHelpers";

describe("REST HTTP Logger", () => {
	describe("log level behavior", () => {
		const config = {
			method: "POST",
			url: "https://api.example.com/endpoint",
			headers: {
				"content-type": "application/json",
			} as unknown as AxiosHeaders,
			data: { key: "value" },
			metadata: createRequestMeta(),
		} as RequestConfigWithMeta;

		it("respects NONE level for trace logs", () => {
			const logger = createMockLogger();

			logRequest(logger, config, HttpClientLogLevel.NONE);
			logResponse(
				logger,
				{ status: 200 } as AxiosResponse,
				HttpClientLogLevel.NONE,
			);
			logError(logger, new Error("test"), HttpClientLogLevel.NONE);

			expect(logger.trace).not.toHaveBeenCalled();
			expect(logger.error).toHaveBeenCalled(); // always log errors
		});

		it("includes headers at HEADERS level but not at BASIC", () => {
			const logger = createMockLogger();

			logRequest(logger, config, HttpClientLogLevel.BASIC);
			expect(logger.trace).not.toHaveBeenCalledWith(
				expect.stringContaining("content-type"),
			);

			vi.clearAllMocks();
			logRequest(logger, config, HttpClientLogLevel.HEADERS);
			expect(logger.trace).toHaveBeenCalledWith(
				expect.stringContaining("content-type"),
			);
		});

		it("includes body at BODY level but not at HEADERS", () => {
			const logger = createMockLogger();

			logRequest(logger, config, HttpClientLogLevel.HEADERS);
			expect(logger.trace).not.toHaveBeenCalledWith(
				expect.stringContaining("key: 'value'"),
			);

			vi.clearAllMocks();
			logRequest(logger, config, HttpClientLogLevel.BODY);
			expect(logger.trace).toHaveBeenCalledWith(
				expect.stringContaining("key: 'value'"),
			);
		});
	});

	describe("error handling", () => {
		it("distinguishes between network errors and response errors", () => {
			const logger = createMockLogger();

			const networkError = new AxiosError("Some Network Error", "ECONNREFUSED");
			networkError.config = {
				metadata: createRequestMeta(),
			} as RequestConfigWithMeta;

			logError(logger, networkError, HttpClientLogLevel.BASIC);
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Some Network Error"),
			);

			// Response error (4xx/5xx)
			vi.clearAllMocks();
			const responseError = new AxiosError("Bad Request");
			responseError.config = {
				metadata: createRequestMeta(),
			} as RequestConfigWithMeta;
			responseError.response = { status: 400 } as AxiosResponse;

			logError(logger, responseError, HttpClientLogLevel.BASIC);
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("400"));
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Bad Request"),
			);
		});

		it("handles non-Axios errors", () => {
			const logger = createMockLogger();
			const error = new Error("Generic error");

			logError(logger, error, HttpClientLogLevel.BASIC);
			expect(logger.error).toHaveBeenCalledWith("Request error", error);
		});
	});

	describe("redaction", () => {
		function makeConfig(): RequestConfigWithMeta {
			return {
				method: "POST",
				url: "https://api.example.com/endpoint",
				headers: {
					authorization: "Bearer request-secret",
					"X-From-Command": "command-secret",
				} as unknown as AxiosHeaders,
				data: { refresh_token: "body-secret" },
				headerCommandKeys: ["X-From-Command"],
				metadata: createRequestMeta(),
			} as RequestConfigWithMeta;
		}

		function loggedText(fn: ReturnType<typeof vi.fn>): string {
			return fn.mock.calls.flat().map(String).join("\n");
		}

		it("redacts sensitive request headers and body fields", () => {
			const logger = createMockLogger();

			logRequest(logger, makeConfig(), HttpClientLogLevel.BODY);

			const logged = loggedText(vi.mocked(logger.trace));
			expect(logged).not.toContain("request-secret");
			expect(logged).not.toContain("command-secret");
			expect(logged).not.toContain("body-secret");
			expect(logged).toContain("authorization: <redacted>");
			expect(logged).toContain("X-From-Command: <redacted>");
		});

		it("redacts sensitive headers and body fields on error paths", () => {
			const logger = createMockLogger();
			const error = new AxiosError("Bad Request");
			error.config = makeConfig();
			error.response = {
				status: 400,
				headers: { "set-cookie": ["session=response-secret"] },
				data: { access_token: "body-secret", error: "invalid_grant" },
			} as unknown as AxiosResponse;

			logError(logger, error, HttpClientLogLevel.BODY);

			const logged = loggedText(vi.mocked(logger.error));
			expect(logged).not.toContain("response-secret");
			expect(logged).not.toContain("body-secret");
			expect(logged).toContain("set-cookie: <redacted>");
			expect(logged).toContain("invalid_grant");
		});

		it("redacts header-command headers on network error paths", () => {
			const logger = createMockLogger();
			const error = new AxiosError("Network Error", "ECONNREFUSED");
			error.config = makeConfig();

			logError(logger, error, HttpClientLogLevel.BODY);

			const logged = loggedText(vi.mocked(logger.error));
			expect(logged).not.toContain("request-secret");
			expect(logged).not.toContain("command-secret");
			expect(logged).not.toContain("body-secret");
		});
	});
});
