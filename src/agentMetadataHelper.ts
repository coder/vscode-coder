import { Api } from "coder/site/src/api/api";
import { WorkspaceAgent } from "coder/site/src/api/typesGenerated";
import { EventSource } from "eventsource";
import * as vscode from "vscode";
import { createStreamingFetchAdapter } from "./api";
import {
	AgentMetadataEvent,
	AgentMetadataEventSchemaArray,
	errToStr,
} from "./api-helper";

export type AgentMetadataWatcher = {
	onChange: vscode.EventEmitter<null>["event"];
	dispose: () => void;
	metadata?: AgentMetadataEvent[];
	error?: unknown;
};

/**
 * Opens an SSE connection to watch metadata for a given workspace agent.
 * Emits onChange when metadata updates or an error occurs.
 */
export function createAgentMetadataWatcher(
	agentId: WorkspaceAgent["id"],
	restClient: Api,
): AgentMetadataWatcher {
	// TODO: Is there a better way to grab the url and token?
	const url = restClient.getAxiosInstance().defaults.baseURL;
	const metadataUrl = new URL(
		`${url}/api/v2/workspaceagents/${agentId}/watch-metadata`,
	);
	const eventSource = new EventSource(metadataUrl.toString(), {
		fetch: createStreamingFetchAdapter(restClient.getAxiosInstance()),
	});

	let disposed = false;
	const onChange = new vscode.EventEmitter<null>();
	const watcher: AgentMetadataWatcher = {
		onChange: onChange.event,
		dispose: () => {
			if (!disposed) {
				eventSource.close();
				disposed = true;
			}
		},
	};

	eventSource.addEventListener("data", (event) => {
		try {
			const dataEvent = JSON.parse(event.data);
			const metadata = AgentMetadataEventSchemaArray.parse(dataEvent);

			// Overwrite metadata if it changed.
			if (JSON.stringify(watcher.metadata) !== JSON.stringify(metadata)) {
				watcher.metadata = metadata;
				onChange.fire(null);
			}
		} catch (error) {
			watcher.error = error;
			onChange.fire(null);
		}
	});

	return watcher;
}

export function formatMetadataError(error: unknown): string {
	return "Failed to query metadata: " + errToStr(error, "no error provided");
}

export function formatEventLabel(metadataEvent: AgentMetadataEvent): string {
	return getEventName(metadataEvent) + ": " + getEventValue(metadataEvent);
}

export function getEventName(metadataEvent: AgentMetadataEvent): string {
	return metadataEvent.description.display_name.trim();
}

export function getEventValue(metadataEvent: AgentMetadataEvent): string {
	return metadataEvent.result.value.replace(/\n/g, "").trim();
}
