import { act, screen } from "@testing-library/react";
import { Profiler, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { agent, workspace, workspacesState } from "@repo/mocks";
import { type WorkspacesState } from "@repo/shared";
import { workspaceNodes } from "@repo/workspaces/components/WorkspacesTree/treeNodes";

import { row } from "../../../ui/components/Tree/treeTestHelpers";
import { pushState, renderApp } from "../../ipc";

// Holds only because the compiled panel and tree skip unchanged props; a
// compiler bailout or a whole-state dependency fails it.
const treeCommits = vi.hoisted(() => vi.fn());

vi.mock(
	"@repo/workspaces/components/WorkspacesTree/treeNodes",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@repo/workspaces/components/WorkspacesTree/treeNodes")
			>();
		return { ...actual, workspaceNodes: vi.fn(actual.workspaceNodes) };
	},
);

vi.mock("@repo/ui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@repo/ui")>();
	return {
		...actual,
		Tree: (props: ComponentProps<typeof actual.Tree>) => (
			<Profiler id="tree" onRender={treeCommits}>
				<actual.Tree {...props} />
			</Profiler>
		),
	};
});

/** Mounts the real App, then counts only tree work after the first state. */
async function setup() {
	vi.useFakeTimers({
		now: new Date("2024-06-15T12:00:00Z"),
		toFake: ["Date", "setInterval", "clearInterval"],
	});
	const state = workspacesState({
		workspaces: [workspace({ name: "alpha", agents: [agent()] })],
		listedAtMs: Date.now(),
	});
	await renderApp(state);
	expect(row("alpha")).toBeInTheDocument();
	vi.mocked(workspaceNodes).mockClear();
	treeCommits.mockClear();
	const work = () => [
		vi.mocked(workspaceNodes).mock.calls.length,
		treeCommits.mock.calls.length,
	];
	return { state, work };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("WorkspacesTree render cost", () => {
	it("skips the tree while only the list age changes", async () => {
		const { state, work } = await setup();

		await act(() => vi.advanceTimersByTimeAsync(60_000));
		expect(screen.getByText("a minute ago")).toBeVisible();
		expect(work()).toEqual([0, 0]);

		// A poll that finds nothing new, deserialized like a posted message.
		// structuredClone would build objects from another realm under vmForks.
		await pushState(
			JSON.parse(
				JSON.stringify({ ...state, listedAtMs: Date.now() }),
			) as WorkspacesState,
		);
		expect(screen.getByText("a few seconds ago")).toBeVisible();
		expect(work()).toEqual([0, 0]);
	});

	it("rebuilds the tree when a workspace changes", async () => {
		const { state, work } = await setup();
		await pushState({
			...state,
			workspaces: [{ ...state.workspaces[0], name: "renamed" }],
		});
		expect(row("renamed")).toBeInTheDocument();
		const [builds, commits] = work();
		expect(builds).toBeGreaterThan(0);
		expect(commits).toBeGreaterThan(0);
	});
});
