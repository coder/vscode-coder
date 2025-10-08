import { type WorkspaceAgent } from "coder/site/src/api/typesGenerated";
import * as vscode from "vscode";

import {
	type AgentMetadataEvent,
	AgentMetadataEventSchemaArray,
	errToStr,
} from "./api-helper";
import { type CoderApi } from "./coderApi";

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
export async function createAgentMetadataWatcher(
	agentId: WorkspaceAgent["id"],
	client: CoderApi,
): Promise<AgentMetadataWatcher> {
	const socket = await client.watchAgentMetadata(agentId);

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

	const handleError = (error: unknown) => {
		watcher.error = error;
		onChange.fire(null);
	};

	socket.addEventListener("message", (event) => {
		try {
			if (event.parseError) {
				handleError(event.parseError);
				return;
			}

			const metadata = AgentMetadataEventSchemaArray.parse(
				event.parsedMessage.data,
			);

			// Overwrite metadata if it changed.
			if (JSON.stringify(watcher.metadata) !== JSON.stringify(metadata)) {
				watcher.metadata = metadata;
				onChange.fire(null);
			}
		} catch (error) {
			handleError(error);
		}
	});

	socket.addEventListener("error", handleError);

	socket.addEventListener("close", (event) => {
		if (event.code !== 1000) {
			handleError(
				new Error(
					`WebSocket closed unexpectedly: ${event.code} ${event.reason}`,
				),
			);
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
