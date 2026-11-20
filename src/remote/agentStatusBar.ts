import * as vscode from "vscode";

import {
	formatEventLabel,
	getEventValue,
	type AgentMetadataEvent,
} from "../api/agentMetadata";
import {
	isWarning,
	type MemoryState,
	type MemoryStatus,
} from "../memory/pressure";
import { formatUsage } from "../memory/usage";

const SHOW_TOP_PROCESSES_COMMAND = "coder.workspace.showTopProcesses";
const RESTART_COMMAND = "coder.workspace.restart";

const BACKGROUNDS: Readonly<Partial<Record<MemoryState, vscode.ThemeColor>>> = {
	high: new vscode.ThemeColor("statusBarItem.warningBackground"),
	processes_killed: new vscode.ThemeColor("statusBarItem.errorBackground"),
};

/** What the template's agent metadata currently provides. */
export type AgentMetadataState =
	| { readonly kind: "none" }
	| { readonly kind: "values"; readonly events: readonly AgentMetadataEvent[] }
	| { readonly kind: "error"; readonly message: string };

/**
 * The agent status bar item combines server-supplied agent metadata with
 * memory measured by the extension. Memory joins the text only when it needs
 * attention or there is no metadata; the background color is reserved for
 * memory, so color always means the user should act.
 */
export class AgentStatusBar implements vscode.Disposable {
	private metadata: AgentMetadataState = { kind: "none" };
	private memory: MemoryStatus = { state: "unavailable" };

	public constructor(private readonly item: vscode.StatusBarItem) {}

	public setMetadata(metadata: AgentMetadataState): void {
		this.metadata = metadata;
		this.render();
	}

	public setMemory(memory: MemoryStatus): void {
		this.memory = memory;
		this.render();
	}

	public dispose(): void {
		this.item.dispose();
	}

	private render(): void {
		const metadataText = renderMetadataText(this.metadata);
		const memoryText = renderMemoryText(
			this.memory,
			metadataText === undefined,
		);
		const parts = [metadataText, memoryText].filter((p) => p !== undefined);
		if (parts.length === 0) {
			this.item.hide();
			return;
		}
		this.item.text = parts.join(" · ");
		this.item.tooltip = renderTooltip(this.metadata, this.memory);
		this.item.backgroundColor = BACKGROUNDS[this.memory.state];
		this.item.command = isWarning(this.memory)
			? SHOW_TOP_PROCESSES_COMMAND
			: undefined;
		this.item.show();
	}
}

function renderMetadataText(metadata: AgentMetadataState): string | undefined {
	switch (metadata.kind) {
		case "values":
			return metadata.events.length > 0
				? `$(dashboard) ${getEventValue(metadata.events[0])}`
				: undefined;
		case "error":
			return "$(warning) Agent Status Unavailable";
		case "none":
			return undefined;
	}
}

function renderMetadataLines(metadata: AgentMetadataState): string[] {
	switch (metadata.kind) {
		case "values":
			return metadata.events.map((event) => formatEventLabel(event));
		case "error":
			return [metadata.message];
		case "none":
			return [];
	}
}

function renderMemoryText(
	memory: MemoryStatus,
	onlyPart: boolean,
): string | undefined {
	switch (memory.state) {
		case "processes_killed":
			return `$(error) Memory ${memory.percent}%`;
		case "high":
			return `$(warning) Memory ${memory.percent}%`;
		case "normal":
			return onlyPart ? `$(dashboard) Memory ${memory.percent}%` : undefined;
		case "unavailable":
			return undefined;
	}
}

function renderTooltip(
	metadata: AgentMetadataState,
	memory: MemoryStatus,
): vscode.MarkdownString {
	const md = new vscode.MarkdownString();
	md.isTrusted = {
		enabledCommands: [SHOW_TOP_PROCESSES_COMMAND, RESTART_COMMAND],
	};
	md.supportThemeIcons = true;

	const metadataLines = renderMetadataLines(metadata);
	if (metadataLines.length > 0) {
		md.appendMarkdown("**Agent metadata**");
		// Template-defined values are untrusted, so they go in as plain text.
		for (const line of metadataLines) {
			md.appendMarkdown("  \n").appendText(line);
		}
	}

	if (memory.state === "unavailable") {
		return md;
	}
	if (md.value) {
		md.appendMarkdown("\n\n");
	}
	md.appendMarkdown(
		`**Workspace usage**  \nMemory: ${formatUsage(memory.sample)} (${memory.percent}%)`,
	);
	if (memory.sample.pressure !== undefined) {
		md.appendMarkdown(
			`  \nPressure: ${memory.sample.pressure}% of time stalled`,
		);
	}
	const warning = memoryWarningSentence(memory);
	if (warning) {
		md.appendMarkdown(
			`\n\n${warning}  \n[$(list-flat) Top processes](command:${SHOW_TOP_PROCESSES_COMMAND} "Open top. Its memory summary covers the whole machine.") · [$(debug-restart) Restart](command:${RESTART_COMMAND} "Restart the workspace")`,
		);
	}
	return md;
}

function memoryWarningSentence(memory: MemoryStatus): string | undefined {
	switch (memory.state) {
		case "processes_killed":
			return "$(error) **Out of memory.**  \nProcesses were killed.";
		case "high":
			return memory.trigger === "pressure"
				? "$(warning) **Memory pressure is high.**  \nThe workspace is slowing down."
				: "$(warning) **Memory is running low.**  \nProcesses may be killed soon.";
		case "normal":
		case "unavailable":
			return undefined;
	}
}
