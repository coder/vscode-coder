import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentChatHistory } from "@repo/tasks/components/AgentChatHistory";

import { logEntry } from "../../mocks/tasks";
import { renderWithQuery } from "../render";

describe("AgentChatHistory", () => {
	describe("empty states", () => {
		it("shows default empty message when no logs", () => {
			renderWithQuery(
				<AgentChatHistory logs={[]} logsStatus="ok" isThinking={false} />,
			);
			expect(screen.getByText("No messages yet")).toBeInTheDocument();
		});

		it("shows not-available message", () => {
			renderWithQuery(
				<AgentChatHistory
					logs={[]}
					logsStatus="not_available"
					isThinking={false}
				/>,
			);
			expect(
				screen.getByText("Logs not available in current task state"),
			).toBeInTheDocument();
		});

		it("shows error message with error styling", () => {
			renderWithQuery(
				<AgentChatHistory logs={[]} logsStatus="error" isThinking={false} />,
			);
			const el = screen.getByText("Failed to load logs");
			expect(el).toBeInTheDocument();
			expect(el).toHaveClass("chat-history-error");
		});
	});

	describe("log rendering", () => {
		it("renders log entries with type-based classes", () => {
			const logs = [
				logEntry({ id: 1, type: "input", content: "Hello" }),
				logEntry({ id: 2, type: "output", content: "Hi there" }),
			];
			renderWithQuery(
				<AgentChatHistory logs={logs} logsStatus="ok" isThinking={false} />,
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
				<AgentChatHistory logs={logs} logsStatus="ok" isThinking={false} />,
			);

			// "You" label at first input, "Agent" label at first output
			expect(screen.getByText("You")).toBeInTheDocument();
			expect(screen.getByText("Agent")).toBeInTheDocument();

			// Only one "You" label for the two consecutive input messages
			expect(screen.getAllByText("You")).toHaveLength(1);
		});

		it("shows role label again when sender changes back", () => {
			const logs = [
				logEntry({ id: 1, type: "input", content: "q1" }),
				logEntry({ id: 2, type: "output", content: "a1" }),
				logEntry({ id: 3, type: "input", content: "q2" }),
			];
			renderWithQuery(
				<AgentChatHistory logs={logs} logsStatus="ok" isThinking={false} />,
			);

			// Two "You" labels: one for first input group, one for the second
			expect(screen.getAllByText("You")).toHaveLength(2);
			expect(screen.getAllByText("Agent")).toHaveLength(1);
		});
	});

	describe("thinking indicator", () => {
		it("shows thinking indicator when isThinking is true", () => {
			renderWithQuery(
				<AgentChatHistory logs={[]} logsStatus="ok" isThinking={true} />,
			);
			expect(screen.getByText("Thinking...")).toBeInTheDocument();
		});

		it("does not show thinking indicator when isThinking is false", () => {
			renderWithQuery(
				<AgentChatHistory logs={[]} logsStatus="ok" isThinking={false} />,
			);
			expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
		});
	});
});
