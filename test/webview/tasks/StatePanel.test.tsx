import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	ErrorState,
	NoTemplateState,
	NotSupportedState,
	StatePanel,
} from "@repo/tasks/components";

import type { ReactElement } from "react";

describe("StatePanel", () => {
	it("renders title when provided", () => {
		render(<StatePanel title="Hello" />);
		expect(screen.getByText("Hello")).not.toBeNull();
	});

	it("renders description when provided", () => {
		render(<StatePanel description="Some description" />);
		expect(screen.getByText("Some description")).not.toBeNull();
	});

	it("renders icon when provided", () => {
		render(<StatePanel icon={<span data-testid="icon" />} />);
		expect(screen.getByTestId("icon")).not.toBeNull();
	});

	it("renders action when provided", () => {
		render(<StatePanel action={<button type="button">Click me</button>} />);
		expect(screen.getByText("Click me")).not.toBeNull();
	});
});

describe("ErrorState", () => {
	it("renders error message", () => {
		render(<ErrorState message="Something went wrong" onRetry={vi.fn()} />);
		expect(screen.getByText("Something went wrong")).not.toBeNull();
	});

	it("calls onRetry when Retry button is clicked", () => {
		const onRetry = vi.fn();
		render(<ErrorState message="Error" onRetry={onRetry} />);
		fireEvent.click(screen.getByText("Retry"));
		expect(onRetry).toHaveBeenCalled();
	});
});

interface InfoStateTestCase {
	name: string;
	element: ReactElement;
	expectedTexts: string[];
	href: string;
}
describe.each<InfoStateTestCase>([
	{
		name: "NoTemplateState",
		element: <NoTemplateState />,
		expectedTexts: ["No Task template found"],
		href: "https://coder.com/docs/admin/templates",
	},
	{
		name: "NotSupportedState",
		element: <NotSupportedState />,
		expectedTexts: [
			"Tasks not available",
			"This Coder server does not support tasks.",
		],
		href: "https://coder.com/docs/tasks",
	},
])("$name", ({ element, expectedTexts, href }) => {
	it("renders text content", () => {
		render(element);
		for (const text of expectedTexts) {
			expect(screen.getByText(text)).not.toBeNull();
		}
	});

	it("renders docs link with correct href", () => {
		render(element);
		expect(screen.getByRole("link").getAttribute("href")).toBe(href);
	});
});
