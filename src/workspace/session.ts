import type * as vscode from "vscode";

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
