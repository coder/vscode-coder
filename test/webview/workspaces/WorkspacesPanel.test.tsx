import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@repo/ui";
import {
	MOCK_WORKSPACES,
	type MockWorkspaceEntry,
} from "@repo/workspaces/mockData";
import { WorkspacesPanel } from "@repo/workspaces/WorkspacesPanel";

const renderPanel = (
	workspaces: readonly MockWorkspaceEntry[] = MOCK_WORKSPACES,
): void => {
	render(
		<TooltipProvider>
			<WorkspacesPanel workspaces={workspaces} isOwner />
		</TooltipProvider>,
	);
};

describe("WorkspacesPanel", () => {
	it("lists owned workspaces and their agents in the tree", () => {
		renderPanel();
		expect(
			screen.getByRole("tree", { name: "Workspaces" }),
		).toBeInTheDocument();
		expect(screen.getByRole("treeitem", { name: "dev" })).toBeInTheDocument();
		expect(
			screen.getByRole("treeitem", { name: "staging" }),
		).toBeInTheDocument();
		// The default "Mine" filter hides other owners.
		expect(screen.queryByRole("treeitem", { name: "ci-pool" })).toBeNull();
	});

	it("filters the tree live from the search input", () => {
		renderPanel();
		fireEvent.change(
			screen.getByRole("searchbox", { name: "Search workspaces" }),
			{ target: { value: "staging" } },
		);
		expect(screen.queryByRole("treeitem", { name: "dev" })).toBeNull();
		expect(
			screen.getByRole("treeitem", { name: "staging" }),
		).toBeInTheDocument();
	});

	it("shows an empty state when the search matches nothing", () => {
		renderPanel();
		fireEvent.change(
			screen.getByRole("searchbox", { name: "Search workspaces" }),
			{ target: { value: "does-not-exist" } },
		);
		expect(screen.getByText("No matching workspaces")).toBeInTheDocument();
		expect(screen.queryByRole("tree")).toBeNull();
	});

	it("switches to the All filter to include other owners", async () => {
		const user = userEvent.setup();
		renderPanel();
		await user.click(screen.getByRole("button", { name: "Mine" }));
		await user.click(screen.getByRole("menuitemradio", { name: "All" }));
		expect(
			screen.getByRole("treeitem", { name: "ci-pool (marcus)" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("treeitem", { name: "code-review (priya)" }),
		).toBeInTheDocument();
	});

	it("shows app statuses and metadata inline under their agent", () => {
		renderPanel();
		const statuses = screen.getByRole("treeitem", { name: "App Statuses" });
		fireEvent.click(statuses);
		expect(
			screen.getByRole("treeitem", {
				name: "CI Watcher: Building packages/ui",
			}),
		).toBeInTheDocument();
		const metadata = screen.getByRole("treeitem", { name: "Agent Metadata" });
		fireEvent.click(metadata);
		expect(
			screen.getByRole("treeitem", { name: "CPU Usage: 23%" }),
		).toBeInTheDocument();
	});

	it("shows loading and error states", () => {
		const loading = render(<WorkspacesPanel workspaces={[]} state="loading" />);
		expect(screen.getByText("Loading workspaces")).toBeInTheDocument();
		loading.unmount();
		const retry = (): void => undefined;
		render(<WorkspacesPanel workspaces={[]} state="error" onRetry={retry} />);
		expect(screen.getByText("Failed to load workspaces")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Try again" }),
		).toBeInTheDocument();
	});

	it("reveals hover actions on the focused workspace row", () => {
		renderPanel();
		const workspace = screen.getByRole("treeitem", { name: "dev" });
		fireEvent.click(workspace);
		expect(
			screen.getByRole("button", { name: "Open dev" }),
		).toBeInTheDocument();
	});
});
