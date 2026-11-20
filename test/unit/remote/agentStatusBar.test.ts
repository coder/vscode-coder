import { describe, expect, it } from "vitest";

import {
	AgentStatusBar,
	type AgentMetadataState,
} from "@/remote/agentStatusBar";

import { MockStatusBarItem } from "../../mocks/testHelpers";

import type { AgentMetadataEvent } from "@/api/agentMetadata";
import type { MemoryStatus, MemoryTrigger } from "@/memory/pressure";

const GiB = 1024 ** 3;

function metadataEvent(name: string, value: string): AgentMetadataEvent {
	return {
		result: { collected_at: "", age: 0, value, error: "" },
		description: {
			display_name: name,
			key: name,
			script: "",
			interval: 10,
			timeout: 5,
		},
	};
}

const VALUES: AgentMetadataState = {
	kind: "values",
	events: [
		metadataEvent("CPU Usage", "0.006/4 cores (0%)"),
		metadataEvent("RAM Usage", "1.32/16 GiB (8%)"),
	],
};
const ERROR: AgentMetadataState = {
	kind: "error",
	message: "Failed to query metadata: closed",
};
const NONE: AgentMetadataState = { kind: "none" };

function memory(
	state: MemoryStatus["state"],
	percent = 25,
	trigger?: MemoryTrigger,
): MemoryStatus {
	if (state === "unavailable") {
		return { state };
	}
	return {
		state,
		percent,
		trigger,
		sample: {
			usedBytes: (percent / 100) * 16 * GiB,
			totalBytes: 16 * GiB,
			source: "host",
		},
	};
}

function render(metadata: AgentMetadataState, status: MemoryStatus) {
	const item = new MockStatusBarItem();
	const bar = new AgentStatusBar(item);
	bar.setMetadata(metadata);
	bar.setMemory(status);
	const tooltip = item.tooltip;
	return {
		item,
		text: item.text,
		tooltip: typeof tooltip === "string" ? tooltip : (tooltip?.value ?? ""),
		background: item.backgroundColor?.id,
		command: item.command,
	};
}

const TOP = "coder.workspace.showTopProcesses";

describe("AgentStatusBar", () => {
	it.each([
		{
			name: "metadata with normal memory keeps today's text",
			metadata: VALUES,
			status: memory("normal"),
			text: "$(dashboard) 0.006/4 cores (0%)",
		},
		{
			name: "high memory joins the metadata text",
			metadata: VALUES,
			status: memory("high", 92, "usage"),
			text: "$(dashboard) 0.006/4 cores (0%) · $(warning) Memory 92%",
			background: "statusBarItem.warningBackground",
			command: TOP,
		},
		{
			name: "killed processes use the error color",
			metadata: VALUES,
			status: memory("processes_killed", 97, "oom_kill"),
			text: "$(dashboard) 0.006/4 cores (0%) · $(error) Memory 97%",
			background: "statusBarItem.errorBackground",
			command: TOP,
		},
		{
			name: "a metadata error alone is not colored",
			metadata: ERROR,
			status: memory("normal"),
			text: "$(warning) Agent Status Unavailable",
		},
		{
			name: "a metadata error still shows high memory",
			metadata: ERROR,
			status: memory("high", 92, "usage"),
			text: "$(warning) Agent Status Unavailable · $(warning) Memory 92%",
			background: "statusBarItem.warningBackground",
			command: TOP,
		},
		{
			name: "without metadata, memory is the only part",
			metadata: NONE,
			status: memory("normal"),
			text: "$(dashboard) Memory 25%",
		},
		{
			name: "unreadable memory leaves the metadata as is",
			metadata: VALUES,
			status: memory("unavailable"),
			text: "$(dashboard) 0.006/4 cores (0%)",
		},
	])("$name", ({ metadata, status, text, background, command }) => {
		const view = render(metadata, status);
		expect(view).toMatchObject({ text, background, command });
		expect(view.item.show).toHaveBeenCalled();
	});

	it("hides when there is no metadata and memory cannot be read", () => {
		const { item } = render(NONE, memory("unavailable"));
		expect(item.hide).toHaveBeenCalled();
		expect(item.show).not.toHaveBeenCalled();
	});

	it("puts the warning and its actions under the IDE measurement", () => {
		const { tooltip } = render(VALUES, memory("high", 92, "usage"));
		expect(tooltip).toBe(
			[
				"**Agent metadata**  ",
				"CPU&nbsp;Usage:&nbsp;0.006/4&nbsp;cores&nbsp;\\(0%\\)  ",
				"RAM&nbsp;Usage:&nbsp;1.32/16&nbsp;GiB&nbsp;\\(8%\\)",
				"",
				"**Workspace usage**  ",
				"Memory: 14.72/16 GiB (92%)",
				"",
				"$(warning) **Memory is running low.**  ",
				"Processes may be killed soon.  ",
				`[$(list-flat) Top processes](command:${TOP} "Open top. Its memory summary covers the whole machine.") · [$(debug-restart) Restart](command:coder.workspace.restart "Restart the workspace")`,
			].join("\n"),
		);
	});

	it("shows a metadata error in the tooltip without a memory section", () => {
		const { tooltip } = render(ERROR, memory("unavailable"));
		expect(tooltip).toBe(
			"**Agent metadata**  \nFailed&nbsp;to&nbsp;query&nbsp;metadata:&nbsp;closed",
		);
	});

	it("shows template values as text, so they cannot add links or icons", () => {
		const { tooltip } = render(
			{
				kind: "values",
				events: [metadataEvent("Note", "[click](command:evil) $(zap)")],
			},
			memory("normal"),
		);
		expect(tooltip).not.toContain("[click](command:evil)");
		expect(tooltip).toContain("\\$\\(zap\\)");
	});
});
