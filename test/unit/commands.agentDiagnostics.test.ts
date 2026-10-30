import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import * as cliExec from "@/cli/cliExec";

import { agent, workspace } from "@repo/mocks";

import { createTestCoderApi } from "../mocks/coderApi";
import { createTestCommands } from "../mocks/commands";
import { createTelemetryHarness } from "../mocks/telemetry";
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
const SPEEDTEST_JSON = JSON.stringify({
	overall: { start_time_seconds: 0, end_time_seconds: 5, throughput_mbits: 42 },
	intervals: [],
});

const main = agent({ id: "agent-main", name: "main" });

/** Commands whose deployment re-reads the workspace as `latest`. */
function setup(latest: Workspace) {
	vi.clearAllMocks();
	new MockConfigurationProvider();
	new MockProgressReporter();
	vi.mocked(cliExec.version).mockResolvedValue("v2.36.0");
	vi.mocked(cliExec.speedtest).mockResolvedValue(SPEEDTEST_JSON);
	vi.mocked(vscode.window.showInputBox).mockResolvedValue("5");
	const { sink, service } = createTelemetryHarness();
	const speedtestPanelFactory = { show: vi.fn() };
	const commands = createTestCommands({
		baseUrl: "https://coder.test",
		client: { getWorkspace: vi.fn(() => Promise.resolve(latest)) },
		services: {
			getTelemetryService: service,
			getCliManager: {
				locateBinary: vi.fn(() => Promise.resolve("/bin/coder")),
				configure: vi.fn(() => Promise.resolve()),
			},
			getPathResolver: { getGlobalConfigDir: () => "/cfg" },
			getSpeedtestPanelFactory: speedtestPanelFactory,
		},
	});
	const aborted = () =>
		sink
			.eventsNamed("command.diagnostic.completed")
			.map((event) => event.properties.abort_stage);
	return { commands, speedtestPanelFactory, aborted };
}

describe("agent diagnostics", () => {
	it.each(["main", "renamed"])(
		"pings the selected agent using its current name %s",
		async (name) => {
			const latest = workspace({ agents: [{ ...main, name }] });
			const { commands } = setup(latest);

			await commands.pingWorkspace({ workspace: latest, agent: main });

			expect(cliExec.ping).toHaveBeenCalledWith(
				expect.anything(),
				`${NAME}.${name}`,
			);
		},
	);

	it("runs a speed test on the given agent", async () => {
		const latest = workspace({ agents: [main] });
		const { commands, speedtestPanelFactory } = setup(latest);

		await commands.speedTest({ workspace: latest, agent: main });

		expect(cliExec.speedtest).toHaveBeenCalledWith(
			expect.anything(),
			`${NAME}.main`,
			"5s",
			expect.anything(),
		);
		expect(speedtestPanelFactory.show).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: `${NAME}.main` }),
		);
	});

	it.each(["main", "renamed"])(
		"refuses to ping the disconnected agent using its current name %s",
		async (name) => {
			const latest = workspace({
				agents: [{ ...main, name, status: "disconnected" }],
			});
			const { commands } = setup(latest);

			await commands.pingWorkspace({ workspace: latest, agent: main });

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				`Cannot ping ${NAME}.${name} while it is disconnected.`,
			);
			expect(cliExec.ping).not.toHaveBeenCalled();
		},
	);

	it("refuses a speed test on an agent that disconnected since it was listed", async () => {
		const latest = workspace({ agents: [{ ...main, status: "disconnected" }] });
		const { commands, aborted } = setup(latest);

		await commands.speedTest({ workspace: latest, agent: main });

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			`Cannot run a speed test on ${NAME}.main while it is disconnected.`,
		);
		expect(vscode.window.showInputBox).not.toHaveBeenCalled();
		expect(cliExec.speedtest).not.toHaveBeenCalled();
		expect(aborted()).toEqual(["unavailable"]);
	});

	it("does not ping a connected agent whose name the CLI cannot address", async () => {
		const latest = workspace({ agents: [main] });
		const { commands } = setup(latest);
		commands.workspace = latest;
		commands.agent = { ...main, name: "main.other" };
		commands.remoteWorkspaceClient = createTestCoderApi({
			baseUrl: "https://coder.test",
		});

		await expect(commands.pingWorkspace()).rejects.toThrow(
			"Cannot use this agent name",
		);

		expect(cliExec.ping).not.toHaveBeenCalled();
	});
});
