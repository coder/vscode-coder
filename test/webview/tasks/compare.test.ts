import { describe, expect, it } from "vitest";

import {
	taskArraysEqual,
	templateArraysEqual,
} from "@repo/tasks/utils/compare";

import { task, taskTemplate } from "../../mocks/tasks";

import type { Task, TaskTemplate } from "@repo/shared";

describe("taskArraysEqual", () => {
	it("returns true for equal arrays", () => {
		const a = [task({ id: "1" }), task({ id: "2" })];
		const b = [task({ id: "1" }), task({ id: "2" })];
		expect(taskArraysEqual(a, b)).toBe(true);
	});

	it("returns false for different lengths", () => {
		const a = [task({ id: "1" })];
		const b = [task({ id: "1" }), task({ id: "2" })];
		expect(taskArraysEqual(a, b)).toBe(false);
	});

	interface TaskFieldTestCase {
		name: string;
		a: Partial<Task>;
		b: Partial<Task>;
	}

	it.each<TaskFieldTestCase>([
		{ name: "id", a: { id: "1" }, b: { id: "2" } },
		{ name: "status", a: { status: "active" }, b: { status: "error" } },
		{
			name: "workspace_status",
			a: { workspace_status: "running" },
			b: { workspace_status: "stopped" },
		},
		{
			name: "display_name",
			a: { display_name: "Task A" },
			b: { display_name: "Task B" },
		},
		{ name: "name", a: { name: "name-a" }, b: { name: "name-b" } },
		{
			name: "current_state.state",
			a: {
				current_state: {
					state: "working",
					message: "",
					timestamp: "",
					uri: "",
				},
			},
			b: {
				current_state: {
					state: "complete",
					message: "",
					timestamp: "",
					uri: "",
				},
			},
		},
		{
			name: "current_state.message",
			a: {
				current_state: {
					state: "working",
					message: "Hello",
					timestamp: "",
					uri: "",
				},
			},
			b: {
				current_state: {
					state: "working",
					message: "World",
					timestamp: "",
					uri: "",
				},
			},
		},
	])("returns false when $name differs", ({ a, b }) => {
		expect(taskArraysEqual([task(a)], [task(b)])).toBe(false);
	});

	it("returns true for both empty", () => {
		expect(taskArraysEqual([], [])).toBe(true);
	});
});

describe("templateArraysEqual", () => {
	it("returns true for equal arrays", () => {
		const a = [taskTemplate({ id: "t1" })];
		const b = [taskTemplate({ id: "t1" })];
		expect(templateArraysEqual(a, b)).toBe(true);
	});

	it("returns false for different lengths", () => {
		const a = [taskTemplate()];
		const b = [taskTemplate(), taskTemplate({ id: "t2" })];
		expect(templateArraysEqual(a, b)).toBe(false);
	});

	interface TemplateFieldTestCase {
		name: string;
		a: Partial<TaskTemplate>;
		b: Partial<TaskTemplate>;
	}

	it.each<TemplateFieldTestCase>([
		{ name: "id", a: { id: "t1" }, b: { id: "t2" } },
		{
			name: "activeVersionId",
			a: { activeVersionId: "v1" },
			b: { activeVersionId: "v2" },
		},
		{
			name: "preset count",
			a: { presets: [] },
			b: {
				presets: [{ id: "p1", name: "Preset 1", isDefault: false }],
			},
		},
		{
			name: "preset name",
			a: {
				presets: [{ id: "p1", name: "Preset A", isDefault: false }],
			},
			b: {
				presets: [{ id: "p1", name: "Preset B", isDefault: false }],
			},
		},
		{
			name: "preset isDefault",
			a: {
				presets: [{ id: "p1", name: "Preset 1", isDefault: false }],
			},
			b: {
				presets: [{ id: "p1", name: "Preset 1", isDefault: true }],
			},
		},
		{
			name: "preset id",
			a: {
				presets: [{ id: "p1", name: "Preset 1", isDefault: false }],
			},
			b: {
				presets: [{ id: "p2", name: "Preset 1", isDefault: false }],
			},
		},
	])("returns false when $name differs", ({ a, b }) => {
		expect(templateArraysEqual([taskTemplate(a)], [taskTemplate(b)])).toBe(
			false,
		);
	});
});
