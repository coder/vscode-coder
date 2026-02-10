import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ErrorState } from "@repo/tasks/components/ErrorState";
import { NoTemplateState } from "@repo/tasks/components/NoTemplateState";
import { NotSupportedState } from "@repo/tasks/components/NotSupportedState";
import { StatePanel } from "@repo/tasks/components/StatePanel";

import type { ReactElement } from "react";

describe("StatePanel", () => {
	it("renders title when provided", () => {
		render(<StatePanel title="Hello" />);
		expect(screen.queryByText("Hello")).toBeInTheDocument();
	});

	it("renders description when provided", () => {
		render(<StatePanel description="Some description" />);
		expect(screen.queryByText("Some description")).toBeInTheDocument();
	});

	it("renders icon when provided", () => {
		render(<StatePanel icon={<span data-testid="icon" />} />);
		expect(screen.queryByTestId("icon")).toBeInTheDocument();
	});

	it("renders action when provided", () => {
		render(<StatePanel action={<button type="button">Click me</button>} />);
		expect(screen.queryByText("Click me")).toBeInTheDocument();
	});
});

describe("ErrorState", () => {
	it("renders error message", () => {
		render(<ErrorState message="Something went wrong" onRetry={vi.fn()} />);
		expect(screen.queryByText("Something went wrong")).toBeInTheDocument();
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
			expect(screen.queryByText(text)).toBeInTheDocument();
		}
	});

	it("renders docs link with correct href", () => {
		render(element);
		expect(screen.getByRole("link")).toHaveAttribute("href", href);
	});
});
