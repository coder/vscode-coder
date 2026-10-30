import { describe, expect, it, onTestFinished, vi } from "vitest";

import { CoderApi } from "@/api/coderApi";
import { CrossOriginRedirectError } from "@/error/crossOriginRedirectError";
import { getHeaders } from "@/headers";

import { startRecordingServer } from "../../mocks/recordingServer";
import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { IncomingHttpHeaders } from "node:http";

// Env proxies would reroute loopback traffic.
vi.mock("@/api/httpAgent", () => ({
	createHttpAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/headers", () => ({ getHeaders: vi.fn() }));

const authHeaders = (headers: IncomingHttpHeaders) => ({
	token: headers["coder-session-token"],
	command: headers["x-custom-auth"],
});
const SENT = { token: "session-token", command: "command-value" };

function get(origin: string, url: string) {
	new MockConfigurationProvider();
	vi.mocked(getHeaders).mockResolvedValue({ "X-Custom-Auth": SENT.command });
	const client = CoderApi.create(origin, SENT.token, createMockLogger());
	onTestFinished(() => client.dispose());
	return client.getAxiosInstance().get(url);
}

describe("CoderApi origin scoping", () => {
	it("keeps auth headers across same-origin redirects", async () => {
		const deployment = await startRecordingServer((path) =>
			path === "/old" ? "/new" : undefined,
		);

		await get(deployment.origin, "/old");

		expect(deployment.requests.map(authHeaders)).toEqual([SENT, SENT]);
	});

	it("refuses a redirect to another origin", async () => {
		const moved = await startRecordingServer();
		const deployment = await startRecordingServer(() => `${moved.origin}/api`);

		await expect(get(deployment.origin, "/api")).rejects.toMatchObject({
			constructor: CrossOriginRedirectError,
			targetOrigin: moved.origin,
		});
		expect(moved.requests).toHaveLength(0);
	});

	it("sends no auth headers to another origin", async () => {
		const deployment = await startRecordingServer();
		const other = await startRecordingServer();

		await get(deployment.origin, `${other.origin}/bin/coder`);

		expect(other.requests.map(authHeaders)).toEqual([
			{ token: undefined, command: undefined },
		]);
	});
});
