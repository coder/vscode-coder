import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceLogs } from "@repo/tasks/components/WorkspaceLogs";

import { task } from "../../mocks/tasks";
import { renderWithQuery } from "../render";

describe("WorkspaceLogs", () => {
	it("shows building header when workspace is building", () => {
		renderWithQuery(
			<WorkspaceLogs
				task={task({ workspace_status: "starting" })}
				lines={[]}
			/>,
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
				lines={[]}
			/>,
		);
		expect(screen.getByText("Running startup scripts...")).toBeInTheDocument();
	});

	it("shows waiting message when no lines", () => {
		renderWithQuery(
			<WorkspaceLogs
				task={task({ workspace_status: "starting" })}
				lines={[]}
			/>,
		);
		expect(screen.getByText("Waiting for logs...")).toBeInTheDocument();
	});

	it("renders log lines", () => {
		const lines = ["Pulling image...", "Starting container...", "Ready"];
		renderWithQuery(
			<WorkspaceLogs
				task={task({ workspace_status: "starting" })}
				lines={lines}
			/>,
		);

		for (const line of lines) {
			expect(screen.getByText(line)).toBeInTheDocument();
		}
		expect(screen.queryByText("Waiting for logs...")).not.toBeInTheDocument();
	});
});
