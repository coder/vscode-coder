import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
	LogViewer,
	LogViewerPlaceholder,
} from "@repo/tasks/components/LogViewer";

import { renderWithQuery } from "../render";

describe("LogViewer", () => {
	it("renders header and children", () => {
		renderWithQuery(
			<LogViewer header="Test header">
				<div>content</div>
			</LogViewer>,
		);
		expect(screen.getByText("Test header")).toBeInTheDocument();
		expect(screen.getByText("content")).toBeInTheDocument();
	});
});

describe("LogViewerPlaceholder", () => {
	it("renders children with empty styling", () => {
		renderWithQuery(<LogViewerPlaceholder>No data</LogViewerPlaceholder>);
		const el = screen.getByText("No data");
		expect(el).toHaveClass("log-viewer-empty");
		expect(el).not.toHaveClass("log-viewer-error");
	});

	it("adds error styling when error is true", () => {
		renderWithQuery(
			<LogViewerPlaceholder error>Something failed</LogViewerPlaceholder>,
		);
		const el = screen.getByText("Something failed");
		expect(el).toHaveClass("log-viewer-empty");
		expect(el).toHaveClass("log-viewer-error");
	});
});
