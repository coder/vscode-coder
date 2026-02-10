import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PromptInput } from "@repo/tasks/components/PromptInput";

import { qs } from "../helpers";

function getTextarea(): HTMLTextAreaElement {
	return screen.getByPlaceholderText<HTMLTextAreaElement>(
		"Prompt your AI agent to start a task...",
	);
}

describe("PromptInput", () => {
	it("send icon disabled when value is empty", () => {
		const { container } = render(
			<PromptInput value="" onChange={vi.fn()} onSubmit={vi.fn()} />,
		);
		expect(qs(container, "vscode-icon")).toHaveClass("disabled");
	});

	it("send icon enabled when value is non-empty", () => {
		const { container } = render(
			<PromptInput value="hello" onChange={vi.fn()} onSubmit={vi.fn()} />,
		);
		expect(qs(container, "vscode-icon")).not.toHaveClass("disabled");
	});

	it("Ctrl+Enter calls onSubmit", () => {
		const onSubmit = vi.fn();
		render(
			<PromptInput value="hello" onChange={vi.fn()} onSubmit={onSubmit} />,
		);
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("Meta+Enter calls onSubmit", () => {
		const onSubmit = vi.fn();
		render(
			<PromptInput value="hello" onChange={vi.fn()} onSubmit={onSubmit} />,
		);
		fireEvent.keyDown(getTextarea(), { key: "Enter", metaKey: true });
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("plain Enter does not call onSubmit", () => {
		const onSubmit = vi.fn();
		render(
			<PromptInput value="hello" onChange={vi.fn()} onSubmit={onSubmit} />,
		);
		fireEvent.keyDown(getTextarea(), { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("does not call onSubmit when value is empty", () => {
		const onSubmit = vi.fn();
		render(<PromptInput value="" onChange={vi.fn()} onSubmit={onSubmit} />);
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("shows spinner when loading", () => {
		const { container } = render(
			<PromptInput
				value="hello"
				onChange={vi.fn()}
				onSubmit={vi.fn()}
				loading
			/>,
		);
		expect(container.querySelector("vscode-progress-ring")).toBeInTheDocument();
		expect(container.querySelector("vscode-icon")).not.toBeInTheDocument();
	});

	it("disables textarea when loading", () => {
		render(
			<PromptInput
				value="hello"
				onChange={vi.fn()}
				onSubmit={vi.fn()}
				loading
			/>,
		);
		expect(getTextarea()).toBeDisabled();
	});

	it("disables textarea when disabled", () => {
		render(
			<PromptInput
				value="hello"
				onChange={vi.fn()}
				onSubmit={vi.fn()}
				disabled
			/>,
		);
		expect(getTextarea()).toBeDisabled();
	});
});
