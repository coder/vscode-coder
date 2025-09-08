import { WorkspaceAgent } from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";
import {
	AgentMetadataEvent,
	AgentMetadataEventSchemaArray,
	errToStr,
} from "./api-helper";
import { CoderWebSocketClient } from "./websocket/webSocketClient";

export type AgentMetadataWatcher = {
	onChange: vscode.EventEmitter<null>["event"];
	dispose: () => void;
	metadata?: AgentMetadataEvent[];
	error?: unknown;
};

/**
 * Opens a websocket connection to watch metadata for a given workspace agent.
 * Emits onChange when metadata updates or an error occurs.
 */
export function createAgentMetadataWatcher(
	agentId: WorkspaceAgent["id"],
	webSocketClient: CoderWebSocketClient,
): AgentMetadataWatcher {
	const socket = webSocketClient.watchAgentMetadata(agentId);

	let disposed = false;
	const onChange = new vscode.EventEmitter<null>();
	const watcher: AgentMetadataWatcher = {
		onChange: onChange.event,
		dispose: () => {
			if (!disposed) {
				socket.close();
				disposed = true;
			}
		},
	};

	socket.addEventListener("message", (event) => {
		try {
			const metadata = AgentMetadataEventSchemaArray.parse(
				event.parsedMessage!.data,
			);

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

	socket.addEventListener("error", (error) => {
		watcher.error = error;
		onChange.fire(null);
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
