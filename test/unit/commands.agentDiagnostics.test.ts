import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import * as cliExec from "@/cli/cliExec";

import { agent, workspace } from "@repo/mocks";

import { createTestCommands } from "../mocks/commands";
import {
	MockConfigurationProvider,
	MockProgressReporter,
} from "../mocks/testHelpers";

import type { Workspace } from "coder/site/src/api/typesGenerated";

vi.mock("@/cli/cliExec", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/cli/cliExec")>()),
	version: vi.fn(),
	ping: vi.fn(),
	speedtest: vi.fn(),
}));

const NAME = "testuser/test-workspace";
const listed = agent({ id: "agent-main", name: "main" });

/** Commands whose deployment re-reads the workspace as `latest`. */
function setup(latest: Workspace) {
	vi.clearAllMocks();
	new MockConfigurationProvider();
	new MockProgressReporter();
	vi.mocked(cliExec.version).mockResolvedValue("v2.36.0");
	vi.mocked(cliExec.speedtest).mockResolvedValue(
		JSON.stringify({
			overall: {
				start_time_seconds: 0,
				end_time_seconds: 5,
				throughput_mbits: 42,
			},
			intervals: [],
		}),
	);
	vi.mocked(vscode.window.showInputBox).mockResolvedValue("5");
	return createTestCommands({
		baseUrl: "https://coder.test",
		client: { getWorkspace: vi.fn(() => Promise.resolve(latest)) },
		services: {
			getCliManager: {
				locateBinary: vi.fn(() => Promise.resolve("/bin/coder")),
				configure: vi.fn(() => Promise.resolve()),
			},
			getPathResolver: { getGlobalConfigDir: () => "/cfg" },
			getSpeedtestPanelFactory: { show: vi.fn() },
		},
	});
}

describe("agent diagnostics", () => {
	it("pings the agent by its current name", async () => {
		const latest = workspace({ agents: [{ ...listed, name: "renamed" }] });

		await setup(latest).pingWorkspace({ workspace: latest, agent: listed });

		expect(cliExec.ping).toHaveBeenCalledWith(
			expect.anything(),
			`${NAME}.renamed`,
		);
	});

	it("runs a speed test on the agent", async () => {
		const latest = workspace({ agents: [listed] });

		await setup(latest).speedTest({ workspace: latest, agent: listed });

		expect(cliExec.speedtest).toHaveBeenCalledWith(
			expect.anything(),
			`${NAME}.main`,
			"5s",
			expect.anything(),
		);
	});

	it.each([
		{ method: "pingWorkspace", verb: "ping" },
		{ method: "speedTest", verb: "run a speed test on" },
	] as const)(
		"refuses $method on a disconnected agent",
		async ({ method, verb }) => {
			const latest = workspace({
				agents: [{ ...listed, status: "disconnected" }],
			});

			await setup(latest)[method]({ workspace: latest, agent: listed });

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				`Cannot ${verb} ${NAME}.main while it is disconnected.`,
			);
			expect(cliExec.ping).not.toHaveBeenCalled();
			expect(cliExec.speedtest).not.toHaveBeenCalled();
		},
	);

	it("does not ping an agent whose name the CLI cannot address", async () => {
		const latest = workspace({ agents: [{ ...listed, name: "main.other" }] });

		await expect(
			setup(latest).pingWorkspace({ workspace: latest, agent: listed }),
		).rejects.toThrow("Cannot use this agent name");

		expect(cliExec.ping).not.toHaveBeenCalled();
	});
});
