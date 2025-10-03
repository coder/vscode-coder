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
});
