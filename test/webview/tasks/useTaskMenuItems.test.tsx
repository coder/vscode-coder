import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTaskMenuItems } from "@repo/tasks/components/useTaskMenuItems";

import { task } from "../../mocks/tasks";

import type { Task } from "@repo/shared";
import type { ActionMenuItem } from "@repo/tasks/components";

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

const pausableTask = () => task({ workspace_status: "running" });
const resumableTask = () => task({ workspace_status: "stopped" });

function deferPause() {
	let resolve: () => void = () => {};
	mockApi.pauseTask.mockReturnValue(
		new Promise<void>((r) => {
			resolve = r;
		}),
	);
	const { result } = renderHook(() =>
		useTaskMenuItems({ task: pausableTask() }),
	);
	return { result, resolve };
}

describe("useTaskMenuItems", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(["View in Coder", "Download Logs", "Delete"])(
		'always includes "%s"',
		(label) => {
			const { result } = renderHook(() => useTaskMenuItems({ task: task() }));
			expect(findByLabel(result.current.menuItems, label)).toBeTruthy();
		},
	);

	it("marks Delete as danger with a separator before it", () => {
		const { result } = renderHook(() => useTaskMenuItems({ task: task() }));
		const items = result.current.menuItems;
		const deleteIdx = items.findIndex(
			(item) => !item.separator && item.label === "Delete",
		);
		expect(items[deleteIdx]).toMatchObject({ label: "Delete", danger: true });
		expect(items[deleteIdx - 1]).toMatchObject({ separator: true });
	});

	interface ConditionalItemTestCase {
		label: string;
		testTask: Task;
	}

	it.each<ConditionalItemTestCase>([
		{ label: "Pause Task", testTask: pausableTask() },
		{ label: "Resume Task", testTask: resumableTask() },
	])("includes $label when action is available", ({ label, testTask }) => {
		const { result } = renderHook(() => useTaskMenuItems({ task: testTask }));
		expect(findByLabel(result.current.menuItems, label)).toBeTruthy();
	});

	it.each<ConditionalItemTestCase>([
		{ label: "Pause Task", testTask: resumableTask() },
		{ label: "Resume Task", testTask: pausableTask() },
	])("excludes $label when action is unavailable", ({ label, testTask }) => {
		const { result } = renderHook(() => useTaskMenuItems({ task: testTask }));
		expect(findByLabel(result.current.menuItems, label)).toBeUndefined();
	});

	interface ApiCallTestCase {
		label: string;
		apiMethod: keyof typeof mockApi;
		testTask: Task;
	}

	it.each<ApiCallTestCase>([
		{
			label: "Pause Task",
			apiMethod: "pauseTask",
			testTask: pausableTask(),
		},
		{
			label: "Resume Task",
			apiMethod: "resumeTask",
			testTask: resumableTask(),
		},
		{ label: "Delete", apiMethod: "deleteTask", testTask: task() },
		{ label: "View in Coder", apiMethod: "viewInCoder", testTask: task() },
		{
			label: "Download Logs",
			apiMethod: "downloadLogs",
			testTask: task(),
		},
	])("$label calls api.$apiMethod", async ({ label, apiMethod, testTask }) => {
		const { result } = renderHook(() => useTaskMenuItems({ task: testTask }));
		clickItem(result.current.menuItems, label);
		await waitFor(() => {
			expect(mockApi[apiMethod]).toHaveBeenCalledWith(testTask.id);
		});
	});

	it("sets action during in-flight request", async () => {
		const { result, resolve } = deferPause();
		clickItem(result.current.menuItems, "Pause Task");
		expect(result.current.action).toBe("pausing");

		await act(async () => {
			resolve();
			await Promise.resolve();
		});
		expect(result.current.action).toBeNull();
	});

	it("ignores duplicate clicks while action is in-flight", async () => {
		const { result, resolve } = deferPause();
		clickItem(result.current.menuItems, "Pause Task");
		clickItem(result.current.menuItems, "Pause Task");
		expect(mockApi.pauseTask).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolve();
			await Promise.resolve();
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
			errorMsg: "Failed to pause task",
		},
		{
			label: "Resume Task",
			apiMethod: "resumeTask",
			testTask: resumableTask(),
			errorMsg: "Failed to resume task",
		},
		{
			label: "Delete",
			apiMethod: "deleteTask",
			testTask: task(),
			errorMsg: "Failed to delete task",
		},
	])(
		"logs error on failed $label",
		async ({ apiMethod, testTask, label, errorMsg }) => {
			mockApi[apiMethod].mockRejectedValueOnce(new Error("Boom"));
			const { result } = renderHook(() => useTaskMenuItems({ task: testTask }));
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
