import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
	EmptyState,
	ErrorState,
	Icon,
	IconButton,
	ProgressBar,
	Spinner,
	StatusPill,
	TooltipProvider,
} from "@repo/ui";

import { qs } from "../helpers";

describe("Icon", () => {
	it("renders a decorative codicon by default", () => {
		const { container } = render(<Icon name="search" />);
		expect(qs(container, ".codicon-search")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
	});

	it("can be labelled when it conveys meaning", () => {
		render(<Icon name="alert" aria-label="Warning" />);
		expect(screen.getByRole("img", { name: "Warning" })).toBeInTheDocument();
	});

	it("can be labelled by another element", () => {
		render(
			<>
				<span id="warning-label">Warning</span>
				<Icon name="alert" aria-labelledby="warning-label" />
			</>,
		);
		expect(screen.getByRole("img", { name: "Warning" })).toBeInTheDocument();
	});
});

describe("IconButton", () => {
	it("has an accessible label and forwards clicks", () => {
		const onClick = vi.fn();
		render(<IconButton icon="refresh" label="Refresh" onClick={onClick} />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
		expect(onClick).toHaveBeenCalledOnce();
	});
	it("hovers with the label unless opted out", async () => {
		const hoverText = async (
			tooltip?: string | null,
		): Promise<string | undefined> => {
			const view = render(
				<TooltipProvider delayDuration={0}>
					<IconButton icon="refresh" label="Refresh" tooltip={tooltip} />
				</TooltipProvider>,
			);
			await userEvent.hover(screen.getByRole("button"));
			const text = screen.queryByRole("tooltip")?.textContent ?? undefined;
			view.unmount();
			return text;
		};
		expect(await hoverText()).toBe("Refresh");
		expect(await hoverText("Reload the list")).toBe("Reload the list");
		expect(await hoverText(null)).toBeUndefined();
	});
});

describe("Spinner", () => {
	it("announces its label", () => {
		render(<Spinner label="Connecting" />);
		expect(
			screen.getByRole("status", { name: "Connecting" }),
		).toBeInTheDocument();
	});
});

describe("ProgressBar", () => {
	it("exposes a clamped determinate value", () => {
		render(<ProgressBar label="Build" value={120} />);
		expect(screen.getByRole("progressbar", { name: "Build" })).toHaveAttribute(
			"aria-valuenow",
			"100",
		);
	});

	it("omits aria-valuenow when indeterminate", () => {
		render(<ProgressBar label="Loading" />);
		expect(
			screen.getByRole("progressbar", { name: "Loading" }),
		).not.toHaveAttribute("aria-valuenow");
	});
});

describe("StatusPill", () => {
	it("applies the requested generic tone", () => {
		render(<StatusPill tone="danger">Failed</StatusPill>);
		expect(screen.getByText("Failed")).toHaveClass("ui-status-pill--danger");
	});

	it("renders an optional icon", () => {
		const { container } = render(
			<StatusPill icon="check" tone="success">
				Running
			</StatusPill>,
		);
		expect(qs(container, ".codicon-check")).toBeInTheDocument();
	});
});

describe("state panels", () => {
	it("renders empty state content and an optional action", () => {
		render(
			<EmptyState
				title="No results"
				description="Change your filters."
				action={<button type="button">Reset filters</button>}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "No results" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Reset filters" }),
		).toBeInTheDocument();
	});

	it("renders an alert and invokes retry", () => {
		const onRetry = vi.fn();
		render(<ErrorState description="Could not load." onRetry={onRetry} />);
		expect(screen.getByRole("alert")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalledOnce();
	});
});
