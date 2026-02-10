import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getTaskLabel, type Task } from "@repo/shared";
import { useTaskMenuItems } from "@repo/tasks/components/useTaskMenuItems";

import { task } from "../../mocks/tasks";
import { QueryWrapper } from "../render";

import type { ActionMenuItem } from "@repo/tasks/components/ActionMenu";

const { mockApi, mockLogger } = vi.hoisted(() => ({
	mockApi: {
		pauseTask: vi.fn(),
		resumeTask: vi.fn(),
		deleteTask: vi.fn(),
		viewInCoder: vi.fn(),
		downloadLogs: vi.fn(),
	},
	mockLogger: {
		error: vi.fn(),
	},
}));

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => mockApi,
}));

vi.mock("@repo/webview-shared/logger", () => ({
	logger: mockLogger,
}));

type ActionButton = Exclude<ActionMenuItem, { separator: true }>;

function findByLabel(
	items: ActionMenuItem[],
	label: string,
): ActionButton | undefined {
	return items.find(
		(item): item is ActionButton => !item.separator && item.label === label,
	);
}

function clickItem(items: ActionMenuItem[], label: string): void {
	act(() => {
		findByLabel(items, label)?.onClick();
	});
}

function renderTask(testTask: Task) {
	return renderHook(() => useTaskMenuItems({ task: testTask }), {
		wrapper: QueryWrapper,
	});
}

const pausableTask = () => task({ status: "active" });
const resumableTask = () => task({ status: "paused" });

function deferPause() {
	let resolve: () => void = () => {};
	mockApi.pauseTask.mockReturnValue(
		new Promise<void>((r) => {
			resolve = r;
		}),
	);
	const { result } = renderTask(pausableTask());
	return { result, resolve };
}

describe("useTaskMenuItems", () => {
	it.each(["View in Coder", "Download Logs", "Delete"])(
		'always includes "%s"',
		(label) => {
			const { result } = renderTask(task());
			expect(findByLabel(result.current.menuItems, label)).toBeTruthy();
		},
	);

	it("marks Delete as danger with a separator before it", () => {
		const { result } = renderTask(task());
		const items = result.current.menuItems;
		const deleteIdx = items.findIndex(
			(item) => !item.separator && item.label === "Delete",
		);
		expect(items[deleteIdx]).toMatchObject({ label: "Delete", danger: true });
		expect(items[deleteIdx - 1]).toMatchObject({ separator: true });
	});

	it("shows Pause for active and Resume for paused tasks", () => {
		const activeItems = renderTask(pausableTask()).result.current.menuItems;
		expect(findByLabel(activeItems, "Pause Task")).toBeTruthy();
		expect(findByLabel(activeItems, "Resume Task")).toBeUndefined();

		const pausedItems = renderTask(resumableTask()).result.current.menuItems;
		expect(findByLabel(pausedItems, "Resume Task")).toBeTruthy();
		expect(findByLabel(pausedItems, "Pause Task")).toBeUndefined();
	});

	interface ActionCallTestCase {
		label: string;
		apiMethod: "pauseTask" | "resumeTask" | "deleteTask";
		testTask: Task;
	}

	it.each<ActionCallTestCase>([
		{ label: "Pause Task", apiMethod: "pauseTask", testTask: pausableTask() },
		{
			label: "Resume Task",
			apiMethod: "resumeTask",
			testTask: resumableTask(),
		},
		{ label: "Delete", apiMethod: "deleteTask", testTask: task() },
	])("$label calls api.$apiMethod", async ({ label, apiMethod, testTask }) => {
		const { result } = renderTask(testTask);
		clickItem(result.current.menuItems, label);
		await waitFor(() => {
			expect(mockApi[apiMethod]).toHaveBeenCalledWith({
				taskId: testTask.id,
				taskName: getTaskLabel(testTask),
			});
		});
	});

	interface CallApiMethodCase {
		label: string;
		apiMethod: keyof typeof mockApi;
	}

	it.each<CallApiMethodCase>([
		{ label: "View in Coder", apiMethod: "viewInCoder" },
		{ label: "Download Logs", apiMethod: "downloadLogs" },
	])("$label calls api.$apiMethod", async ({ label, apiMethod }) => {
		const testTask = task();
		const { result } = renderTask(testTask);
		clickItem(result.current.menuItems, label);
		await waitFor(() => {
			expect(mockApi[apiMethod]).toHaveBeenCalledWith(testTask.id);
		});
	});

	it("sets action during in-flight request", async () => {
		const { result, resolve } = deferPause();
		clickItem(result.current.menuItems, "Pause Task");
		await waitFor(() => {
			expect(result.current.action).toBe("pausing");
		});

		resolve();
		await waitFor(() => {
			expect(result.current.action).toBeNull();
		});
	});

	it("ignores duplicate clicks while action is in-flight", async () => {
		const { result, resolve } = deferPause();
		clickItem(result.current.menuItems, "Pause Task");

		await waitFor(() => {
			expect(result.current.action).toBe("pausing");
		});
		const callsAfterFirst = mockApi.pauseTask.mock.calls.length;

		clickItem(result.current.menuItems, "Pause Task");
		clickItem(result.current.menuItems, "Pause Task");
		expect(mockApi.pauseTask.mock.calls.length).toBe(callsAfterFirst);

		act(() => {
			resolve();
		});
	});

	interface ErrorLogTestCase {
		label: string;
		apiMethod: keyof typeof mockApi;
		testTask: Task;
		errorMsg: string;
	}

	it.each<ErrorLogTestCase>([
		{
			label: "Pause Task",
			apiMethod: "pauseTask",
			testTask: pausableTask(),
			errorMsg: "Failed while pausing task",
		},
		{
			label: "Resume Task",
			apiMethod: "resumeTask",
			testTask: resumableTask(),
			errorMsg: "Failed while resuming task",
		},
		{
			label: "Delete",
			apiMethod: "deleteTask",
			testTask: task(),
			errorMsg: "Failed while deleting task",
		},
		{
			label: "Download Logs",
			apiMethod: "downloadLogs",
			testTask: task(),
			errorMsg: "Failed while downloading task",
		},
	])(
		"logs error on failed $label",
		async ({ apiMethod, testTask, label, errorMsg }) => {
			mockApi[apiMethod].mockRejectedValueOnce(new Error("Boom"));
			const { result } = renderTask(testTask);
			clickItem(result.current.menuItems, label);
			await waitFor(() => {
				expect(mockLogger.error).toHaveBeenCalledWith(
					errorMsg,
					expect.any(Error),
				);
			});
		},
	);
});
