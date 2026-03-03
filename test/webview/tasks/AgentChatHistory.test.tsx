import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentChatHistory } from "@repo/tasks/components/AgentChatHistory";

import { logEntry } from "../../mocks/tasks";
import { renderWithQuery } from "../render";

import type { TaskLogs } from "@repo/shared";

describe("AgentChatHistory", () => {
	describe("empty states", () => {
		it("shows default empty message when no logs", () => {
			renderWithQuery(
				<AgentChatHistory
					taskLogs={{ status: "ok", logs: [] }}
					isThinking={false}
				/>,
			);
			expect(screen.getByText("No messages yet")).toBeInTheDocument();
		});

		it("shows not-available message", () => {
			renderWithQuery(
				<AgentChatHistory
					taskLogs={{ status: "not_available" }}
					isThinking={false}
				/>,
			);
			expect(
				screen.getByText("Messages are not available yet"),
			).toBeInTheDocument();
		});

		it("shows error message with error styling", () => {
			renderWithQuery(
				<AgentChatHistory taskLogs={{ status: "error" }} isThinking={false} />,
			);
			const el = screen.getByText("Failed to load messages");
			expect(el).toBeInTheDocument();
			expect(el).toHaveClass("log-viewer-error");
		});
	});

	describe("log rendering", () => {
		it("renders log entries with type-based classes", () => {
			const logs = [
				logEntry({ id: 1, type: "input", content: "Hello" }),
				logEntry({ id: 2, type: "output", content: "Hi there" }),
			];
			renderWithQuery(
				<AgentChatHistory
					taskLogs={{ status: "ok", logs }}
					isThinking={false}
				/>,
			);

			const input = screen.getByText("Hello").closest(".log-entry");
			expect(input).toHaveClass("log-entry-input");

			const output = screen.getByText("Hi there").closest(".log-entry");
			expect(output).toHaveClass("log-entry-output");
		});

		it("shows role label at the start of each sender group", () => {
			const logs = [
				logEntry({ id: 1, type: "input", content: "msg1" }),
				logEntry({ id: 2, type: "input", content: "msg2" }),
				logEntry({ id: 3, type: "output", content: "msg3" }),
			];
			renderWithQuery(
				<AgentChatHistory
					taskLogs={{ status: "ok", logs }}
					isThinking={false}
				/>,
			);

			// "User" label at first input, "Agent" label at first output
			expect(screen.getByText("[User]")).toBeInTheDocument();
			expect(screen.getByText("[Agent]")).toBeInTheDocument();

			// Only one "User" label for the two consecutive input messages
			expect(screen.getAllByText("[User]")).toHaveLength(1);
		});

		it("shows role label again when sender changes back", () => {
			const logs = [
				logEntry({ id: 1, type: "input", content: "q1" }),
				logEntry({ id: 2, type: "output", content: "a1" }),
				logEntry({ id: 3, type: "input", content: "q2" }),
			];
			renderWithQuery(
				<AgentChatHistory
					taskLogs={{ status: "ok", logs }}
					isThinking={false}
				/>,
			);

			// Two "User" labels: one for first input group, one for the second
			expect(screen.getAllByText("[User]")).toHaveLength(2);
			expect(screen.getAllByText("[Agent]")).toHaveLength(1);
		});
	});

	describe("snapshot header", () => {
		interface SnapshotHeaderTestCase {
			name: string;
			taskLogs: TaskLogs;
			expectedHeader: string;
			hasInfoIcon: boolean;
		}
		it.each<SnapshotHeaderTestCase>([
			{
				name: "snapshot=false → Chat history",
				taskLogs: {
					status: "ok",
					logs: [logEntry({ id: 1 })],
					snapshot: false,
				},
				expectedHeader: "Chat history",
				hasInfoIcon: false,
			},
			{
				name: "snapshot=undefined → Chat history",
				taskLogs: { status: "ok", logs: [logEntry({ id: 1 })] },
				expectedHeader: "Chat history",
				hasInfoIcon: false,
			},
			{
				name: "snapshot=true, 0 logs → AI chat logs",
				taskLogs: { status: "ok", logs: [], snapshot: true },
				expectedHeader: "AI chat logs",
				hasInfoIcon: false,
			},
			{
				name: "snapshot=true, 3 logs → Last 3 messages",
				taskLogs: {
					status: "ok",
					logs: [logEntry({ id: 1 }), logEntry({ id: 2 }), logEntry({ id: 3 })],
					snapshot: true,
				},
				expectedHeader: "Last 3 messages of AI chat logs",
				hasInfoIcon: false,
			},
			{
				name: "snapshot=true with snapshotAt → info icon",
				taskLogs: {
					status: "ok",
					logs: [logEntry({ id: 1 })],
					snapshot: true,
					snapshotAt: "2024-06-15T10:30:00Z",
				},
				expectedHeader: "Last message of AI chat logs",
				hasInfoIcon: true,
			},
			{
				name: "snapshot=false with snapshotAt → no info icon",
				taskLogs: {
					status: "ok",
					logs: [logEntry({ id: 1 })],
					snapshot: false,
					snapshotAt: "2024-06-15T10:30:00Z",
				},
				expectedHeader: "Chat history",
				hasInfoIcon: false,
			},
		])("$name", ({ taskLogs, expectedHeader, hasInfoIcon }) => {
			renderWithQuery(
				<AgentChatHistory taskLogs={taskLogs} isThinking={false} />,
			);
			expect(screen.getByText(expectedHeader)).toBeInTheDocument();
			if (hasInfoIcon) {
				expect(document.querySelector(".codicon-info")).toBeInTheDocument();
			} else {
				expect(document.querySelector(".codicon-info")).not.toBeInTheDocument();
			}
		});

		it("tooltip shows relative time", () => {
			renderWithQuery(
				<AgentChatHistory
					taskLogs={{
						status: "ok",
						logs: [logEntry({ id: 1 })],
						snapshot: true,
						snapshotAt: "2024-06-15T10:30:00Z",
					}}
					isThinking={false}
				/>,
			);
			const tooltip = document.querySelector(".snapshot-info-tooltip");
			expect(tooltip?.textContent).toContain("Snapshot taken");
			expect(tooltip?.textContent).toContain("ago");
		});
	});

	describe("thinking indicator", () => {
		it("shows thinking indicator when isThinking is true", () => {
			renderWithQuery(
				<AgentChatHistory
					taskLogs={{ status: "ok", logs: [] }}
					isThinking={true}
				/>,
			);
			expect(screen.getByText("Thinking...")).toBeInTheDocument();
		});

		it("does not show thinking indicator when isThinking is false", () => {
			renderWithQuery(
				<AgentChatHistory
					taskLogs={{ status: "ok", logs: [] }}
					isThinking={false}
				/>,
			);
			expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
		});
	});
});
