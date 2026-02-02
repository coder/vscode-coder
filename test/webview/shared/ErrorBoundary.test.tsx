import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@repo/webview-shared/logger";
import { ErrorBoundary } from "@repo/webview-shared/react/ErrorBoundary";

vi.mock("@repo/webview-shared/logger", () => ({
	logger: { error: vi.fn() },
}));

const TEST_ERROR = "TEST_ERROR_BOUNDARY_ERROR";

function ThrowingComponent(): never {
	throw new Error(TEST_ERROR);
}

describe("ErrorBoundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Suppress only our test error, fail on unexpected errors
		vi.spyOn(globalThis.console, "error").mockImplementation(
			(...args: unknown[]) => {
				const str = args.map(String).join(" ");
				if (str.includes(TEST_ERROR)) {
					return;
				}
				throw new Error(`Unexpected console.error: ${str}`);
			},
		);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders children when no error", () => {
		render(
			<ErrorBoundary>
				<div>Hello World</div>
			</ErrorBoundary>,
		);
		expect(screen.getByText("Hello World")).toBeTruthy();
	});

	it("renders default fallback on error", () => {
		render(
			<ErrorBoundary>
				<ThrowingComponent />
			</ErrorBoundary>,
		);
		expect(screen.getByText("Something went wrong")).toBeTruthy();
		expect(screen.getByText(TEST_ERROR)).toBeTruthy();
	});

	it("renders custom fallback on error", () => {
		render(
			<ErrorBoundary fallback={<div>Custom error UI</div>}>
				<ThrowingComponent />
			</ErrorBoundary>,
		);
		expect(screen.getByText("Custom error UI")).toBeTruthy();
		expect(screen.queryByText("Something went wrong")).toBeNull();
	});

	it("logs error via componentDidCatch", () => {
		render(
			<ErrorBoundary>
				<ThrowingComponent />
			</ErrorBoundary>,
		);
		expect(logger.error).toHaveBeenCalledWith(
			"Webview error:",
			expect.any(Error),
			expect.objectContaining({ componentStack: expect.any(String) }),
		);
	});
});
