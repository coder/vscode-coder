import { render, screen } from "@testing-library/react";
import { TaskStatuses } from "coder/site/src/api/typesGenerated";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { StatusIndicator } from "@repo/tasks/components/StatusIndicator";

import { task } from "../../mocks/tasks";

import type { TaskStatus } from "@repo/shared";

const css = readFileSync(resolve("packages/tasks/src/index.css"), "utf-8");

describe("StatusIndicator", () => {
	it.each<TaskStatus>(TaskStatuses)(
		"renders status '%s' with matching class and title",
		(status) => {
			const expectedTitle = status.charAt(0).toUpperCase() + status.slice(1);
			render(<StatusIndicator task={task({ status })} />);
			const dot = screen.getByTitle(expectedTitle);
			expect(dot).toHaveClass(status);
		},
	);

	it.each<TaskStatus>(TaskStatuses)(
		"has a CSS rule for status '%s'",
		(status) => {
			expect(css).toMatch(new RegExp(`\\.status-dot\\.${status}\\b`));
		},
	);
});
