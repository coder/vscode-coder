import type * as vscode from "vscode";

/**
 * A point-in-time view of the deployment session for workspace providers.
 *
 * `revision` increments on every sign-in or sign-out. Consumers snapshot the
 * revision before an async call and compare afterward to detect that the
 * session changed while the call was in flight.
 */
export type WorkspaceSessionSnapshot =
	| { readonly kind: "signedOut"; readonly revision: number }
	| {
			readonly kind: "signedIn";
			readonly revision: number;
			readonly userId: string;
	  };

export interface WorkspaceSessionState {
	getSnapshot(): WorkspaceSessionSnapshot;
	onDidChange: vscode.Event<WorkspaceSessionSnapshot>;
}
