/* eslint-disable @typescript-eslint/ban-ts-comment */
import axios from "axios";
import * as fs from "fs/promises";
import https from "https";
import * as path from "path";
import { afterAll, beforeAll, it, expect, vi, describe } from "vitest";
import {
	CertificateError,
	X509_ERR,
	X509_ERR_CODE,
	getErrorDetail,
} from "./error";
import { createMockOutputChannelWithLogger } from "./test-helpers";

// Setup all mocks
beforeAll(() => {
	vi.mock("vscode", () => ({
		window: {
			showErrorMessage: vi.fn(),
			showInformationMessage: vi.fn(),
		},
		workspace: {
			getConfiguration: vi.fn(() => ({
				update: vi.fn(),
			})),
		},
		ConfigurationTarget: {
			Global: 1,
		},
	}));
});

// Mock the coder/site modules
vi.mock("coder/site/src/api/errors", () => ({
	isApiError: vi.fn((error: unknown) => {
		const err = error as {
			isAxiosError?: boolean;
			response?: { data?: { detail?: string } };
		};
		return (
			err?.isAxiosError === true && err?.response?.data?.detail !== undefined
		);
	}),
	isApiErrorResponse: vi.fn((error: unknown) => {
		const err = error as { detail?: string };
		return err?.detail !== undefined && typeof err.detail === "string";
	}),
}));

const logger = {
	writeToCoderOutputChannel(message: string) {
		throw new Error(message);
	},
};

const disposers: (() => void)[] = [];
afterAll(() => {
	disposers.forEach((d) => d());
});

// Helpers
async function startServer(certName: string): Promise<string> {
	const server = https.createServer(
		{
			key: await fs.readFile(
				path.join(__dirname, `../fixtures/tls/${certName}.key`),
			),
			cert: await fs.readFile(
				path.join(__dirname, `../fixtures/tls/${certName}.crt`),
			),
		},
		(req, res) => {
			if (req.url?.endsWith("/error")) {
				res.writeHead(500);
				res.end("error");
				return;
			}
			res.writeHead(200);
			res.end("foobar");
		},
	);
	disposers.push(() => server.close());
	return new Promise<string>((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address) {
				throw new Error("Server has no address");
			}
			if (typeof address !== "string") {
				const host =
					address.family === "IPv6" ? `[${address.address}]` : address.address;
				return resolve(`https://${host}:${address.port}`);
			}
			resolve(address);
		});
	});
}

const createAxiosTestRequest = (address: string, agentConfig?: object) =>
	axios.get(
		address,
		agentConfig ? { httpsAgent: new https.Agent(agentConfig) } : {},
	);

const isElectron =
	process.versions.electron || process.env.ELECTRON_RUN_AS_NODE;

// Certificate test cases
const certificateTests = [
	{
		name: "partial chains",
		certName: "chain-leaf",
		expectedCode: X509_ERR_CODE.UNABLE_TO_VERIFY_LEAF_SIGNATURE,
		expectedErr: X509_ERR.PARTIAL_CHAIN,
		trustConfig: { ca: "chain-leaf.crt" },
		shouldSucceedWhenTrusted: false,
		environmentSpecific: false,
	},
	{
		name: "self-signed certificates without signing capability",
		certName: "no-signing",
		expectedCode: X509_ERR_CODE.UNABLE_TO_VERIFY_LEAF_SIGNATURE,
		expectedErr: X509_ERR.NON_SIGNING,
		trustConfig: { ca: "no-signing.crt", servername: "localhost" },
		shouldSucceedWhenTrusted: !isElectron,
		environmentSpecific: true,
	},
	{
		name: "self-signed certificates",
		certName: "self-signed",
		expectedCode: X509_ERR_CODE.DEPTH_ZERO_SELF_SIGNED_CERT,
		expectedErr: X509_ERR.UNTRUSTED_LEAF,
		trustConfig: { ca: "self-signed.crt", servername: "localhost" },
		shouldSucceedWhenTrusted: true,
		environmentSpecific: false,
	},
	{
		name: "an untrusted chain",
		certName: "chain",
		expectedCode: X509_ERR_CODE.SELF_SIGNED_CERT_IN_CHAIN,
		expectedErr: X509_ERR.UNTRUSTED_CHAIN,
		trustConfig: { ca: "chain-root.crt", servername: "localhost" },
		shouldSucceedWhenTrusted: true,
		environmentSpecific: false,
	},
];

describe.each(certificateTests)(
	"Certificate validation: $name",
	({
		certName,
		expectedCode,
		expectedErr,
		trustConfig,
		shouldSucceedWhenTrusted,
		environmentSpecific,
	}) => {
		it("detects certificate error", async () => {
			const address = await startServer(certName);
			const request = createAxiosTestRequest(address);

			if (!environmentSpecific || (environmentSpecific && isElectron)) {
				await expect(request).rejects.toHaveProperty("code", expectedCode);
			}

			try {
				await request;
			} catch (error) {
				const wrapped = await CertificateError.maybeWrap(
					error,
					address,
					logger,
				);
				if (!environmentSpecific || (environmentSpecific && isElectron)) {
					expect(wrapped instanceof CertificateError).toBeTruthy();
					expect((wrapped as CertificateError).x509Err).toBe(expectedErr);
				}
			}
		});

		it("can bypass with rejectUnauthorized: false", async () => {
			const address = await startServer(certName);
			const request = createAxiosTestRequest(address, {
				rejectUnauthorized: false,
			});
			await expect(request).resolves.toHaveProperty("data", "foobar");
		});

		if (trustConfig) {
			it("handles trusted certificate", async () => {
				const address = await startServer(certName);
				const agentConfig = {
					...trustConfig,
					ca: trustConfig.ca
						? await fs.readFile(
								path.join(__dirname, `../fixtures/tls/${trustConfig.ca}`),
							)
						: undefined,
				};
				const request = createAxiosTestRequest(address, agentConfig);

				if (shouldSucceedWhenTrusted) {
					await expect(request).resolves.toHaveProperty("data", "foobar");
				} else if (!environmentSpecific || isElectron) {
					await expect(request).rejects.toHaveProperty("code", expectedCode);
				}
			});
		}
	},
);

it("falls back with different error", async () => {
	const address = await startServer("chain");
	const request = axios.get(address + "/error", {
		httpsAgent: new https.Agent({
			ca: await fs.readFile(
				path.join(__dirname, "../fixtures/tls/chain-root.crt"),
			),
			servername: "localhost",
		}),
	});
	await expect(request).rejects.toThrow(/failed with status code 500/);
	try {
		await request;
	} catch (error) {
		const wrapped = await CertificateError.maybeWrap(error, "1", logger);
		expect(wrapped instanceof CertificateError).toBeFalsy();
		expect((wrapped as Error).message).toMatch(/failed with status code 500/);
	}
});

describe("getErrorDetail", () => {
	it.each([
		[
			"API error response",
			{
				isAxiosError: true,
				response: { data: { detail: "API error detail message" } },
			},
			"API error detail message",
		],
		[
			"error response object",
			{ detail: "Error response detail message" },
			"Error response detail message",
		],
		["regular error", new Error("Regular error"), null],
		["string error", "String error", null],
		["undefined", undefined, null],
	])("should return detail from %s", (_, input, expected) => {
		expect(getErrorDetail(input)).toBe(expected);
	});
});

describe("CertificateError.maybeWrap error handling", () => {
	it.each([
		[
			"errors thrown by determineVerifyErrorCause",
			{
				isAxiosError: true,
				code: X509_ERR_CODE.UNABLE_TO_VERIFY_LEAF_SIGNATURE,
				message: "unable to verify leaf signature",
			},
			true,
			"Failed to parse certificate from https://test.com",
		],
		["non-axios errors", new Error("Not a certificate error"), false, null],
		[
			"unknown axios error codes",
			{
				isAxiosError: true,
				code: "UNKNOWN_ERROR_CODE",
				message: "Unknown error",
			},
			false,
			null,
		],
	])("should handle %s", async (_, error, shouldLog, expectedLog) => {
		const loggerSpy = { writeToCoderOutputChannel: vi.fn() };

		if (shouldLog && expectedLog) {
			const originalDetermine = CertificateError.determineVerifyErrorCause;
			CertificateError.determineVerifyErrorCause = vi
				.fn()
				.mockRejectedValue(new Error("Failed to parse certificate"));

			const result = await CertificateError.maybeWrap(
				error,
				"https://test.com",
				loggerSpy,
			);
			expect(result).toBe(error);
			expect(loggerSpy.writeToCoderOutputChannel).toHaveBeenCalledWith(
				expect.stringContaining(expectedLog),
			);

			CertificateError.determineVerifyErrorCause = originalDetermine;
		} else {
			const result = await CertificateError.maybeWrap(
				error,
				"https://test.com",
				logger,
			);
			expect(result).toBe(error);
		}
	});
});

describe("CertificateError with real Logger", () => {
	it("should work with Logger implementation", async () => {
		const { mockOutputChannel, logger: realLogger } =
			createMockOutputChannelWithLogger();

		// Mock determineVerifyErrorCause to throw
		const originalDetermine = CertificateError.determineVerifyErrorCause;
		CertificateError.determineVerifyErrorCause = vi
			.fn()
			.mockRejectedValue(new Error("Failed to parse certificate"));

		const axiosError = {
			isAxiosError: true,
			code: X509_ERR_CODE.UNABLE_TO_VERIFY_LEAF_SIGNATURE,
			message: "unable to verify leaf signature",
		};

		const result = await CertificateError.maybeWrap(
			axiosError,
			"https://test.com",
			realLogger,
		);
		expect(result).toBe(axiosError);
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringMatching(
				/\[.*\] \[INFO\] Failed to parse certificate from https:\/\/test.com/,
			),
		);

		const logs = realLogger.getLogs();
		expect(logs[0].message).toContain(
			"Failed to parse certificate from https://test.com",
		);

		CertificateError.determineVerifyErrorCause = originalDetermine;
	});

	it("should log successful certificate wrapping", async () => {
		const { logger: realLogger } = createMockOutputChannelWithLogger();
		const address = await startServer("chain");

		try {
			await createAxiosTestRequest(address);
		} catch (error) {
			realLogger.clear();
			const wrapped = await CertificateError.maybeWrap(
				error,
				address,
				realLogger,
			);
			expect(wrapped instanceof CertificateError).toBeTruthy();
			expect((wrapped as CertificateError).x509Err).toBe(
				X509_ERR.UNTRUSTED_CHAIN,
			);
			expect(realLogger.getLogs()).toHaveLength(0);
		}
	});
});

describe("CertificateError instance methods", () => {
	const createCertError = async (code: string) => {
		const axiosError = { isAxiosError: true, code, message: "test error" };
		return await CertificateError.maybeWrap(
			axiosError,
			"https://test.com",
			logger,
		);
	};

	it("should update configuration when allowInsecure is called", async () => {
		const vscode = await import("vscode");
		const mockUpdate = vi.fn();
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			update: mockUpdate,
		} as never);

		const certError = await createCertError(
			X509_ERR_CODE.DEPTH_ZERO_SELF_SIGNED_CERT,
		);
		(certError as CertificateError).allowInsecure();

		expect(mockUpdate).toHaveBeenCalledWith(
			"coder.insecure",
			true,
			vscode.ConfigurationTarget.Global,
		);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			CertificateError.InsecureMessage,
		);
	});

	it.each([
		["with title", "Test Title", true],
		["without title", undefined, false],
	])("should show notification %s", async (_, title, hasTitle) => {
		const vscode = await import("vscode");
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(
			CertificateError.ActionOK as never,
		);

		const certError = await createCertError(
			X509_ERR_CODE.SELF_SIGNED_CERT_IN_CHAIN,
		);

		if (hasTitle && title) {
			await (certError as CertificateError).showModal(title);
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				title,
				{ detail: X509_ERR.UNTRUSTED_CHAIN, modal: true, useCustom: true },
				CertificateError.ActionOK,
			);
		} else {
			await (certError as CertificateError).showNotification();
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				X509_ERR.UNTRUSTED_CHAIN,
				{},
				CertificateError.ActionOK,
			);
		}
	});

	it("should call allowInsecure when ActionAllowInsecure is selected", async () => {
		const vscode = await import("vscode");
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(
			CertificateError.ActionAllowInsecure as never,
		);

		const certError = (await createCertError(
			X509_ERR_CODE.DEPTH_ZERO_SELF_SIGNED_CERT,
		)) as CertificateError;
		const allowInsecureSpy = vi.spyOn(certError, "allowInsecure");

		await certError.showNotification("Test");
		expect(allowInsecureSpy).toHaveBeenCalled();
	});
});

describe("Logger integration", () => {
	it.each([
		[
			"Logger wrapper",
			(
				realLogger: ReturnType<
					typeof createMockOutputChannelWithLogger
				>["logger"],
			) => ({
				writeToCoderOutputChannel: (msg: string) => realLogger.info(msg),
			}),
		],
		[
			"Storage with Logger",
			(
				realLogger: ReturnType<
					typeof createMockOutputChannelWithLogger
				>["logger"],
			) => ({
				writeToCoderOutputChannel: (msg: string) => realLogger.info(msg),
			}),
		],
	])(
		"should log certificate parsing errors through %s",
		async (_, createWrapper) => {
			const { logger: realLogger } = createMockOutputChannelWithLogger();
			const wrapper = createWrapper(realLogger);

			const axiosError = {
				isAxiosError: true,
				code: X509_ERR_CODE.UNABLE_TO_VERIFY_LEAF_SIGNATURE,
				message: "unable to verify the first certificate",
			};

			const spy = vi
				.spyOn(CertificateError, "determineVerifyErrorCause")
				.mockRejectedValue(new Error("Failed to parse certificate"));

			await CertificateError.maybeWrap(
				axiosError,
				"https://example.com",
				wrapper,
			);

			const logs = realLogger.getLogs();
			expect(
				logs.some((log) =>
					log.message.includes(
						"Failed to parse certificate from https://example.com",
					),
				),
			).toBe(true);

			spy.mockRestore();
		},
	);
});
