import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PromptInput } from "@repo/tasks/components/PromptInput";

import { qs } from "../helpers";

const defaults = {
	onChange: vi.fn(),
	onSubmit: vi.fn(),
	actionIcon: "send",
	actionLabel: "Send",
	actionEnabled: true,
} as const;

function getTextarea(): HTMLTextAreaElement {
	return screen.getByPlaceholderText<HTMLTextAreaElement>(
		"Prompt your AI agent to start a task...",
	);
}

describe("PromptInput", () => {
	it("send icon disabled when actionEnabled is false", () => {
		const { container } = render(
			<PromptInput {...defaults} value="" actionEnabled={false} />,
		);
		expect(qs(container, "vscode-icon")).toHaveClass("disabled");
	});

	it("send icon enabled when actionEnabled is true", () => {
		const { container } = render(<PromptInput {...defaults} value="hello" />);
		expect(qs(container, "vscode-icon")).not.toHaveClass("disabled");
	});

	it("Ctrl+Enter calls onSubmit", () => {
		const onSubmit = vi.fn();
		render(<PromptInput {...defaults} value="hello" onSubmit={onSubmit} />);
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("Meta+Enter calls onSubmit", () => {
		const onSubmit = vi.fn();
		render(<PromptInput {...defaults} value="hello" onSubmit={onSubmit} />);
		fireEvent.keyDown(getTextarea(), { key: "Enter", metaKey: true });
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("plain Enter does not call onSubmit", () => {
		const onSubmit = vi.fn();
		render(<PromptInput {...defaults} value="hello" onSubmit={onSubmit} />);
		fireEvent.keyDown(getTextarea(), { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("does not call onSubmit when actionEnabled is false", () => {
		const onSubmit = vi.fn();
		render(
			<PromptInput
				{...defaults}
				value=""
				onSubmit={onSubmit}
				actionEnabled={false}
			/>,
		);
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("shows spinner when loading", () => {
		const { container } = render(
			<PromptInput {...defaults} value="hello" loading />,
		);
		expect(container.querySelector("vscode-progress-ring")).toBeInTheDocument();
		expect(container.querySelector("vscode-icon")).not.toBeInTheDocument();
	});

	it("disables textarea when loading", () => {
		render(<PromptInput {...defaults} value="hello" loading />);
		expect(getTextarea()).toBeDisabled();
	});

	it("disables textarea when disabled", () => {
		render(<PromptInput {...defaults} value="hello" disabled />);
		expect(getTextarea()).toBeDisabled();
	});
});
