import url from "node:url";
import * as vscode from "vscode";

/**
 * Given a URL, return the host in a format that is safe to write.
 */
export function toSafeHost(rawUrl: string): string {
	const u = new URL(rawUrl);
	// If the host is invalid, an empty string is returned.  Although, `new URL`
	// should already have thrown in that case.
	return url.domainToASCII(u.hostname) || u.hostname;
}

export function removeTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, "");
}

/**
 * Return the URL for opening Coder pages in the browser.  Uses the
 * `coder.alternativeWebUrl` setting when configured, otherwise returns
 * the connection URL unchanged.
 */
export function resolveUiUrl(connectionUrl: string): string {
	const alt = removeTrailingSlashes(
		vscode.workspace
			.getConfiguration("coder")
			.get<string>("alternativeWebUrl")
			?.trim() ?? "",
	);
	return alt || connectionUrl;
}

/**
 * Open a path on the Coder deployment in the user's browser, applying
 * `coder.alternativeWebUrl` when configured.
 */
export function openInBrowser(
	connectionUrl: string,
	path: string,
): Thenable<boolean> {
	const base = vscode.Uri.parse(resolveUiUrl(connectionUrl));
	return vscode.env.openExternal(vscode.Uri.joinPath(base, path));
}
