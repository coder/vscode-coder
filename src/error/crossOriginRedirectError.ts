import * as vscode from "vscode";

import { vscodeProposed } from "../vscode/proposed";

/** A redirect to another origin that was refused. */
export class CrossOriginRedirectError extends Error {
	/** Where the user can sign in instead, for http(s) targets. */
	readonly targetOrigin: string | undefined;

	constructor(target: string) {
		const url = URL.parse(target);
		super(
			`The deployment redirected to ${url?.origin ?? "another origin"}. If it moved, sign in with its new URL.`,
		);
		this.name = "CrossOriginRedirectError";
		this.targetOrigin = url?.protocol.startsWith("http")
			? url.origin
			: undefined;
	}

	/** Finds the error in `err`'s cause chain; axios wraps it. */
	static find(err: unknown): CrossOriginRedirectError | undefined {
		for (let e = err; e instanceof Error; e = e.cause) {
			if (e instanceof CrossOriginRedirectError) {
				return e;
			}
		}
		return undefined;
	}

	async showNotification(title: string, { modal = true } = {}): Promise<void> {
		const signIn = this.targetOrigin && `Sign In to ${this.targetOrigin}`;
		const action = await vscodeProposed.window.showErrorMessage(
			modal ? title : `${title}: ${this.message}`,
			{ detail: this.message, modal, useCustom: modal },
			...(signIn ? [signIn] : []),
		);
		if (signIn && action === signIn) {
			await vscode.commands.executeCommand("coder.login", {
				url: this.targetOrigin,
			});
		}
	}
}
