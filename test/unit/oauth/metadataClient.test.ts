import axios, {
	type AxiosInstance,
	type AxiosRequestConfig,
	type AxiosResponse,
	type InternalAxiosRequestConfig,
} from "axios";
import { describe, expect, it, vi, type Mock } from "vitest";

import { getHeaders } from "@/headers";
import { OAuthMetadataClient } from "@/oauth/metadataClient";

import {
	createMockLogger,
	setupAxiosMockRoutes,
} from "../../mocks/testHelpers";

import { createMockOAuthMetadata, TEST_URL } from "./testUtils";

vi.mock("axios", async () => {
	const actual = await vi.importActual<typeof import("axios")>("axios");
	const mockAdapter = vi.fn();
	return {
		...actual,
		default: {
			...actual.default,
			create: vi.fn((config?: AxiosRequestConfig) =>
				actual.default.create({ ...config, adapter: mockAdapter }),
			),
			__mockAdapter: mockAdapter,
		},
	};
});

vi.mock("@/headers", () => ({
	getHeaders: vi.fn().mockResolvedValue({}),
	getHeaderCommand: vi.fn(),
}));

vi.mock("@/api/utils", async () => {
	const actual =
		await vi.importActual<typeof import("@/api/utils")>("@/api/utils");
	return { ...actual, createHttpAgent: vi.fn() };
});

type MockAdapter = Mock<
	(config: InternalAxiosRequestConfig) => Promise<AxiosResponse<unknown>>
>;

function createTestContext() {
	vi.resetAllMocks();

	const axiosMock = axios as typeof axios & { __mockAdapter: MockAdapter };
	const mockAdapter = axiosMock.__mockAdapter;

	vi.mocked(getHeaders).mockResolvedValue({});

	const axiosInstance: AxiosInstance = axios.create({ baseURL: TEST_URL });
	const client = new OAuthMetadataClient(axiosInstance, createMockLogger());

	return { mockAdapter, client, axiosInstance };
}

describe("OAuthMetadataClient", () => {
	describe("getMetadata", () => {
		it("fetches and returns valid metadata", async () => {
			const { mockAdapter, client } = createTestContext();

			const metadata = createMockOAuthMetadata(TEST_URL);
			setupAxiosMockRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server": metadata,
			});

			const result = await client.getMetadata();

			expect(result).toEqual(metadata);
		});

		describe("required endpoints validation", () => {
			it.each(["authorization_endpoint", "token_endpoint", "issuer"])(
				"throws when %s missing",
				async (field) => {
					const { mockAdapter, client } = createTestContext();

					setupAxiosMockRoutes(mockAdapter, {
						"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
							TEST_URL,
							{ [field]: undefined },
						),
					});

					await expect(client.getMetadata()).rejects.toThrow(
						"OAuth server metadata missing required endpoints",
					);
				},
			);
		});

		describe("grant type validation", () => {
			it("accepts metadata with required grant types", async () => {
				const { mockAdapter, client } = createTestContext();

				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
						TEST_URL,
						{ grant_types_supported: ["authorization_code", "refresh_token"] },
					),
				});

				const result = await client.getMetadata();
				expect(result.grant_types_supported).toEqual([
					"authorization_code",
					"refresh_token",
				]);
			});

			it("throws when required grant types missing", async () => {
				const { mockAdapter, client } = createTestContext();

				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
						TEST_URL,
						{ grant_types_supported: ["client_credentials"] },
					),
				});

				await expect(client.getMetadata()).rejects.toThrow(
					"Server does not support required grant types: authorization_code, refresh_token",
				);
			});

			it("applies RFC 8414 defaults when grant_types_supported omitted", async () => {
				const { mockAdapter, client } = createTestContext();

				// RFC 8414 default is ["authorization_code"] which doesn't include refresh_token
				// So this should fail validation
				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
						TEST_URL,
						{ grant_types_supported: undefined },
					),
				});

				await expect(client.getMetadata()).rejects.toThrow(
					"Server does not support required grant types",
				);
			});
		});

		describe("response type validation", () => {
			it("throws when 'code' response type not supported", async () => {
				const { mockAdapter, client } = createTestContext();

				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
						TEST_URL,
						{ response_types_supported: ["token"] },
					),
				});

				await expect(client.getMetadata()).rejects.toThrow(
					"Server does not support required response type: code",
				);
			});

			it("applies RFC 8414 defaults when response_types_supported omitted", async () => {
				const { mockAdapter, client } = createTestContext();

				// RFC 8414 default is ["code"] which is what we need
				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
						TEST_URL,
						{ response_types_supported: undefined },
					),
				});

				// Should pass because default includes "code"
				const result = await client.getMetadata();
				expect(result.response_types_supported).toBeUndefined();
			});
		});

		describe("auth method validation", () => {
			interface AuthMethodTestCase {
				name: string;
				value: readonly ["client_secret_basic"] | undefined;
			}
			it.each<AuthMethodTestCase>([
				{ name: "unsupported method", value: ["client_secret_basic"] },
				{ name: "RFC 8414 default", value: undefined },
			])("throws for $name", async ({ value }) => {
				const { mockAdapter, client } = createTestContext();

				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
						TEST_URL,
						{ token_endpoint_auth_methods_supported: value },
					),
				});

				await expect(client.getMetadata()).rejects.toThrow(
					"Server does not support required auth method: client_secret_post",
				);
			});
		});

		describe("PKCE validation", () => {
			it("throws when S256 not supported", async () => {
				const { mockAdapter, client } = createTestContext();

				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
						TEST_URL,
						{ code_challenge_methods_supported: ["plain"] },
					),
				});

				await expect(client.getMetadata()).rejects.toThrow(
					"Server does not support required PKCE method: S256",
				);
			});

			it("treats missing code_challenge_methods_supported as unsupported", async () => {
				const { mockAdapter, client } = createTestContext();

				setupAxiosMockRoutes(mockAdapter, {
					"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
						TEST_URL,
						{ code_challenge_methods_supported: undefined },
					),
				});

				await expect(client.getMetadata()).rejects.toThrow(
					"Server does not support required PKCE method: S256. Supported: none",
				);
			});
		});
	});

	describe("checkOAuthSupport", () => {
		it("returns true when endpoint exists", async () => {
			const { mockAdapter, axiosInstance } = createTestContext();

			setupAxiosMockRoutes(mockAdapter, {
				"/.well-known/oauth-authorization-server":
					createMockOAuthMetadata(TEST_URL),
			});

			const result = await OAuthMetadataClient.checkOAuthSupport(axiosInstance);
			expect(result).toBe(true);
		});

		it.each([
			{
				name: "404",
				error: Object.assign(new Error("Not Found"), {
					response: { status: 404 },
				}),
			},
			{ name: "network error", error: new Error("Network Error") },
		])("returns false on $name", async ({ error }) => {
			const { mockAdapter, axiosInstance } = createTestContext();

			mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
				if (config.url?.includes("well-known")) {
					return Promise.reject(error);
				}
				return Promise.resolve({
					data: {},
					status: 200,
					statusText: "OK",
					headers: {},
					config,
				});
			});

			const result = await OAuthMetadataClient.checkOAuthSupport(axiosInstance);
			expect(result).toBe(false);
		});
	});
});
