import { defineCommand, defineNotification } from "../ipc/protocol";

import type {
	PreviewParameter,
	FriendlyDiagnostic,
} from "coder/site/src/api/typesGenerated";

export interface WorkspaceUpdateState {
	readonly workspaceName: string;
	readonly templateVersionId: string;
	readonly revision: number;
	readonly status:
		"loading" | "evaluating" | "ready" | "submitting" | "success" | "error";
	readonly parameters: readonly PreviewParameter[];
	readonly inputs: Readonly<Record<string, string>>;
	readonly locked: readonly string[];
	readonly diagnostics: readonly FriendlyDiagnostic[];
	readonly error?: string;
	readonly canSubmit: boolean;
	readonly canRetry?: boolean;
}

export const WorkspaceUpdateApi = {
	stateChanged: defineNotification<WorkspaceUpdateState>(
		"workspaceUpdate/stateChanged",
	),
	ready: defineCommand<void>("workspaceUpdate/ready"),
	change: defineCommand<{ name: string; value: string }>(
		"workspaceUpdate/change",
	),
	retry: defineCommand<void>("workspaceUpdate/retry"),
	submit: defineCommand<{ revision: number }>("workspaceUpdate/submit"),
	cancel: defineCommand<void>("workspaceUpdate/cancel"),
} as const;
