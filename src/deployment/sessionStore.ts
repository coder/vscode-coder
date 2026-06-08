import * as vscode from "vscode";

import type { User } from "coder/site/src/api/typesGenerated";

import type {
	WorkspaceSessionSnapshot,
	WorkspaceSessionState,
} from "../workspace/session";

import type { Deployment } from "./types";

/**
 * The deployment session: signed out (optionally keeping the last deployment
 * for re-login) or signed in with an authenticated user.
 *
 * Every transition makes a new object, so callers can spot a change by
 * comparing identity against an earlier value.
 */
export type SessionData =
	| { readonly kind: "signedOut"; readonly deployment: Deployment | null }
	| {
			readonly kind: "signedIn";
			readonly deployment: Deployment;
			readonly user: User;
	  };

/**
 * Owns the deployment session. State changes only through signIn()/signOut(),
 * each of which bumps the revision and notifies listeners.
 *
 * Consumers that only need auth status (like the workspace tree) take the lean
 * WorkspaceSessionState projection instead of the full session.
 */
export class SessionStore implements WorkspaceSessionState {
	#data: SessionData = { kind: "signedOut", deployment: null };
	#revision = 0;
	readonly #onDidChange = new vscode.EventEmitter<WorkspaceSessionSnapshot>();

	public readonly onDidChange = this.#onDidChange.event;

	/** Full session state, including deployment and user. */
	public get current(): SessionData {
		return this.#data;
	}

	/** Lean projection for consumers that only track auth status and revision. */
	public getSnapshot(): WorkspaceSessionSnapshot {
		if (this.#data.kind === "signedIn") {
			return {
				kind: "signedIn",
				revision: this.#revision,
				userId: this.#data.user.id,
			};
		}
		return { kind: "signedOut", revision: this.#revision };
	}

	public signIn(deployment: Deployment, user: User): SessionData {
		return this.transition({ kind: "signedIn", deployment, user });
	}

	public signOut(deployment: Deployment | null): SessionData {
		return this.transition({ kind: "signedOut", deployment });
	}

	private transition(data: SessionData): SessionData {
		this.#data = data;
		this.#revision++;
		this.#onDidChange.fire(this.getSnapshot());
		return data;
	}

	public dispose(): void {
		this.#onDidChange.dispose();
	}
}
