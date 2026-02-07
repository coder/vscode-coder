import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTaskMenuItems } from "@repo/tasks/components/useTaskMenuItems";

import { task } from "../../mocks/tasks";

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

function deferPause() {
	let resolve: () => void = () => {};
	mockApi.pauseTask.mockReturnValue(
		new Promise<void>((r) => {
			resolve = r;
		}),
	);
	const { result } = renderHook(() =>
		useTaskMenuItems({ task: task(), canPause: true }),
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
		name: string;
		label: string;
		opts: { canPause?: boolean; canResume?: boolean };
	}

	it.each<ConditionalItemTestCase>([
		{
			name: "Pause when canPause",
			label: "Pause Task",
			opts: { canPause: true },
		},
		{
			name: "Resume when canResume",
			label: "Resume Task",
			opts: { canResume: true },
		},
	])("includes $name", ({ label, opts }) => {
		const { result } = renderHook(() =>
			useTaskMenuItems({ task: task(), ...opts }),
		);
		expect(findByLabel(result.current.menuItems, label)).toBeTruthy();
	});

	it.each<ConditionalItemTestCase>([
		{
			name: "Pause when !canPause",
			label: "Pause Task",
			opts: { canPause: false },
		},
		{
			name: "Resume when !canResume",
			label: "Resume Task",
			opts: { canResume: false },
		},
	])("excludes $name", ({ label, opts }) => {
		const { result } = renderHook(() =>
			useTaskMenuItems({ task: task(), ...opts }),
		);
		expect(findByLabel(result.current.menuItems, label)).toBeUndefined();
	});

	interface ApiCallTestCase {
		label: string;
		apiMethod: keyof typeof mockApi;
		opts?: { canPause?: boolean; canResume?: boolean };
	}

	it.each<ApiCallTestCase>([
		{ label: "Pause Task", apiMethod: "pauseTask", opts: { canPause: true } },
		{
			label: "Resume Task",
			apiMethod: "resumeTask",
			opts: { canResume: true },
		},
		{ label: "Delete", apiMethod: "deleteTask" },
		{ label: "View in Coder", apiMethod: "viewInCoder" },
		{ label: "Download Logs", apiMethod: "downloadLogs" },
	])("$label calls api.$apiMethod", async ({ label, apiMethod, opts }) => {
		const { result } = renderHook(() =>
			useTaskMenuItems({ task: task({ id: "t-1" }), ...opts }),
		);
		clickItem(result.current.menuItems, label);
		await waitFor(() => {
			expect(mockApi[apiMethod]).toHaveBeenCalledWith("t-1");
		});
	});

	it("delete calls onDeleted callback", async () => {
		const onDeleted = vi.fn();
		const { result } = renderHook(() =>
			useTaskMenuItems({ task: task({ id: "t-4" }), onDeleted }),
		);
		clickItem(result.current.menuItems, "Delete");
		await waitFor(() => {
			expect(onDeleted).toHaveBeenCalled();
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
		opts: { canPause?: boolean; canResume?: boolean };
		errorMsg: string;
	}

	it.each<ErrorLogTestCase>([
		{
			label: "Pause Task",
			apiMethod: "pauseTask",
			opts: { canPause: true },
			errorMsg: "Failed to pause task:",
		},
		{
			label: "Resume Task",
			apiMethod: "resumeTask",
			opts: { canResume: true },
			errorMsg: "Failed to resume task:",
		},
		{
			label: "Delete",
			apiMethod: "deleteTask",
			opts: {},
			errorMsg: "Failed to delete task:",
		},
	])(
		"logs error on failed $label",
		async ({ apiMethod, opts, label, errorMsg }) => {
			mockApi[apiMethod].mockRejectedValueOnce(new Error("Boom"));
			const { result } = renderHook(() =>
				useTaskMenuItems({ task: task(), ...opts }),
			);
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
