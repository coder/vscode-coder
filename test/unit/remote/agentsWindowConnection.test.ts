import { describe, expect, it, vi } from "vitest";

import { prepareAgentsWindowConnection } from "@/remote/agentsWindowConnection";
import { WorkspaceStateMachine } from "@/remote/workspaceStateMachine";
import { PathResolver } from "@/storage/pathResolver";
import { WorkspaceMonitor } from "@/workspace/workspaceMonitor";

import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "@repo/mocks";

import { createTestCoderApi } from "../../mocks/coderApi";
import {
	createMockServiceContainer,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { CliManager } from "@/cli/cliManager";
import type { AgentsWindowOpenTrace } from "@/instrumentation/workspaceOpen";
import type { ConnectionSetup } from "@/remote/connectionSetup";

vi.mock("@/workspace/workspaceMonitor", () => ({
	WorkspaceMonitor: { create: vi.fn() },
}));
vi.mock("@/remote/workspaceStateMachine", () => ({
	WorkspaceStateMachine: vi.fn(),
}));

const AUTHORITY = "ssh-remote+coder-vscode.dev.coder.com--foo--bar.main";

describe("prepareAgentsWindowConnection", () => {
	it("starts on prompt and writes the SSH config plain ssh reads", async () => {
		new MockConfigurationProvider();
		const agent = createAgent({ id: "agent-1", name: "main" });
		const workspace = createWorkspace({
			owner_name: "foo",
			name: "bar",
			latest_build: { resources: [createResource({ agents: [agent] })] },
		});
		const monitor = { dispose: vi.fn() };
		vi.mocked(WorkspaceMonitor.create).mockResolvedValue(
			monitor as unknown as WorkspaceMonitor,
		);
		vi.mocked(WorkspaceStateMachine).mockImplementation(function () {
			return { getAgentId: () => agent.id, dispose: vi.fn() };
		});
		const connectionSetup = {
			resolveBinary: vi.fn().mockResolvedValue("/bin/coder"),
			checkCompatibility: vi.fn().mockResolvedValue({
				serverFeatures: {},
				cliAuth: {},
				sessionApp: "vscode",
			}),
			waitForWorkspaceReady: vi.fn().mockResolvedValue(workspace),
			writeSshConfig: vi.fn().mockResolvedValue({}),
		};
		const trace = {
			phase: (_name: string, fn: () => Promise<unknown>) => fn(),
		} as AgentsWindowOpenTrace;

		const ready = await prepareAgentsWindowConnection({
			client: createTestCoderApi({ baseUrl: "https://dev.coder.com" }),
			baseUrl: "https://dev.coder.com",
			workspace,
			remoteAuthority: AUTHORITY,
			connectionSetup: connectionSetup as unknown as ConnectionSetup,
			serviceContainer: createMockServiceContainer({
				cliManager: { configure: vi.fn() } as unknown as CliManager,
				pathResolver: new PathResolver("/mock/global", "/mock/log"),
			}),
			trace,
		});

		expect(ready).toEqual({ workspace, agent });
		expect(vi.mocked(WorkspaceStateMachine).mock.calls[0][2]).toBe("none");
		expect(monitor.dispose).toHaveBeenCalled();
		expect(connectionSetup.writeSshConfig).toHaveBeenCalledWith(
			expect.objectContaining({ configFile: undefined, sshPath: undefined }),
		);
	});
});
