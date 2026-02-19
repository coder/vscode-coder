import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceLogs } from "@repo/tasks/components/WorkspaceLogs";
import * as hookModule from "@repo/tasks/hooks/useWorkspaceLogs";

import { task } from "../../mocks/tasks";
import { renderWithQuery } from "../render";

vi.mock("@repo/tasks/hooks/useWorkspaceLogs", () => ({
	useWorkspaceLogs: () => [] as string[],
}));

describe("WorkspaceLogs", () => {
	it("shows building header when workspace is building", () => {
		renderWithQuery(
			<WorkspaceLogs task={task({ workspace_status: "starting" })} />,
		);
		expect(screen.getByText("Building workspace...")).toBeInTheDocument();
	});

	it("shows startup scripts header when agent is starting", () => {
		renderWithQuery(
			<WorkspaceLogs
				task={task({
					workspace_status: "running",
					workspace_agent_lifecycle: "starting",
				})}
			/>,
		);
		expect(screen.getByText("Running startup scripts...")).toBeInTheDocument();
	});

	it("shows waiting message when no lines", () => {
		renderWithQuery(
			<WorkspaceLogs task={task({ workspace_status: "starting" })} />,
		);
		expect(screen.getByText("Waiting for logs...")).toBeInTheDocument();
	});

	it("renders log lines instead of placeholder", () => {
		vi.spyOn(hookModule, "useWorkspaceLogs").mockReturnValue(["Ready"]);

		renderWithQuery(
			<WorkspaceLogs task={task({ workspace_status: "starting" })} />,
		);

		expect(screen.getByText("Ready")).toBeInTheDocument();
		expect(screen.queryByText("Waiting for logs...")).not.toBeInTheDocument();

		vi.mocked(hookModule.useWorkspaceLogs).mockReturnValue([]);
	});
});
