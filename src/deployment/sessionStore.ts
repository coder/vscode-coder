import * as vscode from "vscode";

import type { User } from "coder/site/src/api/typesGenerated";

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
 * Read-only session access: the current data plus change notifications.
 *
 * To detect a change across an await, keep the SessionData read before the
 * await and compare it by identity afterward; sign-in and sign-out always
 * replace the object.
 */
export interface SessionState {
	readonly current: SessionData;
	readonly onDidChange: vscode.Event<SessionData>;
}

/**
 * Owns the deployment session. State changes only through signIn()/signOut(),
 * each of which replaces the session object and notifies listeners.
 */
export class SessionStore implements SessionState {
	#data: SessionData = { kind: "signedOut", deployment: null };
	readonly #onDidChange = new vscode.EventEmitter<SessionData>();

	public readonly onDidChange = this.#onDidChange.event;

	public get current(): SessionData {
		return this.#data;
	}

	public signIn(deployment: Deployment, user: User): SessionData {
		return this.transition({ kind: "signedIn", deployment, user });
	}

	public signOut(deployment: Deployment | null): SessionData {
		return this.transition({ kind: "signedOut", deployment });
	}

	private transition(data: SessionData): SessionData {
		this.#data = data;
		this.#onDidChange.fire(data);
		return data;
	}

	public dispose(): void {
		this.#onDidChange.dispose();
	}
}
