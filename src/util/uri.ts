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

/** Trim surrounding whitespace and strip trailing slashes from a URL. */
export function normalizeUrl(value: string): string {
	return removeTrailingSlashes(value.trim());
}

/**
 * Return the URL for opening Coder pages in the browser.  Uses the
 * `coder.alternativeWebUrl` setting when configured, otherwise returns
 * the connection URL unchanged.
 */
export function resolveCoderDashboardUrl(connectionUrl: string): string {
	const alt = normalizeUrl(
		vscode.workspace
			.getConfiguration("coder")
			.get<string>("alternativeWebUrl") ?? "",
	);
	return alt || connectionUrl;
}

/**
 * Open a path in the user's browser, resolved against `coder.alternativeWebUrl`
 * when set, otherwise against `connectionUrl`.
 */
export function openInBrowser(
	connectionUrl: string,
	path: string,
): Thenable<boolean> {
	const base = vscode.Uri.parse(resolveCoderDashboardUrl(connectionUrl));
	return vscode.env.openExternal(vscode.Uri.joinPath(base, path));
}
