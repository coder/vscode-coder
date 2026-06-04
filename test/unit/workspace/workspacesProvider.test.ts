import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	WorkspaceProvider,
	WorkspaceQuery,
} from "@/workspace/workspacesProvider";

import { workspace as createWorkspace } from "@repo/mocks";

import { createMockLogger } from "../../mocks/testHelpers";

import type { Workspace } from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";

const baseUrl = "https://coder.example.com";

class MockClient {
	baseURL: string | undefined = baseUrl;
	readonly getWorkspaces = vi.fn(
		(_req: {
			q: string;
		}): Promise<{
			workspaces: readonly Workspace[];
			count: number;
		}> => Promise.resolve({ workspaces: [], count: 0 }),
	);

	getAxiosInstance() {
		return {
			defaults: {
				baseURL: this.baseURL,
			},
		};
	}
}

describe("WorkspaceProvider", () => {
	let client: MockClient;
	let isAuthenticated: () => boolean;

	beforeEach(() => {
		client = new MockClient();
		isAuthenticated = vi.fn<() => boolean>(() => true);
	});

	function createProvider(
		query: WorkspaceQuery,
		options: {
			filterWorkspaces?: (
				workspaces: readonly Workspace[],
			) => readonly Workspace[];
			getStateVersion?: () => number;
			timerSeconds?: number;
		} = {},
	) {
		return new WorkspaceProvider(
			query,
			client as unknown as CoderApi,
			createMockLogger(),
			isAuthenticated,
			options.timerSeconds,
			options.filterWorkspaces,
			options.getStateVersion,
		);
	}

	async function fetchVisible(provider: WorkspaceProvider) {
		provider.setVisibility(true);
		await new Promise((resolve) => setImmediate(resolve));
	}

	it("queries shared workspaces", async () => {
		const provider = createProvider(WorkspaceQuery.Shared);

		await fetchVisible(provider);

		expect(client.getWorkspaces).toHaveBeenCalledWith({
			q: WorkspaceQuery.Shared,
		});
	});

	it("applies the workspace filter before rendering tree items", async () => {
		client.getWorkspaces.mockResolvedValueOnce({
			workspaces: [
				createWorkspace({
					id: "owned-workspace",
					owner_id: "current-user",
					owner_name: "current",
					name: "owned",
				}),
				createWorkspace({
					id: "shared-workspace",
					owner_id: "other-user",
					owner_name: "alice",
					name: "shared",
				}),
			],
			count: 2,
		});
		const provider = createProvider(WorkspaceQuery.Shared, {
			filterWorkspaces: (workspaces) =>
				workspaces.filter((workspace) => workspace.owner_id !== "current-user"),
		});

		await fetchVisible(provider);
		const children = await provider.getChildren();

		expect(children).toHaveLength(1);
		expect(children[0]?.label).toBe("alice / shared");
	});

	it("fails closed when the shared workspace filter cannot identify the current user", async () => {
		client.getWorkspaces.mockResolvedValueOnce({
			workspaces: [
				createWorkspace({
					id: "shared-workspace",
					owner_id: "other-user",
					owner_name: "alice",
					name: "shared",
				}),
			],
			count: 1,
		});
		const provider = createProvider(WorkspaceQuery.Shared, {
			filterWorkspaces: () => [],
		});

		await fetchVisible(provider);
		const children = await provider.getChildren();

		expect(children).toEqual([]);
	});

	it("refetches when auth state changes while a request is pending", async () => {
		let stateVersion = 1;
		let resolveFirst!: (response: {
			workspaces: readonly Workspace[];
			count: number;
		}) => void;
		client.getWorkspaces
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
			)
			.mockResolvedValueOnce({
				workspaces: [
					createWorkspace({
						id: "fresh-workspace",
						owner_id: "other-user",
						owner_name: "alice",
						name: "fresh",
					}),
				],
				count: 1,
			});
		const provider = createProvider(WorkspaceQuery.Shared, {
			getStateVersion: () => stateVersion,
		});

		provider.setVisibility(true);
		await new Promise((resolve) => setImmediate(resolve));
		stateVersion = 2;
		resolveFirst({
			workspaces: [
				createWorkspace({
					id: "stale-workspace",
					owner_id: "other-user",
					owner_name: "bob",
					name: "stale",
				}),
			],
			count: 1,
		});
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));

		const children = await provider.getChildren();

		expect(client.getWorkspaces).toHaveBeenCalledTimes(2);
		expect(children).toHaveLength(1);
		expect(children[0]?.label).toBe("alice / fresh");
	});
});
