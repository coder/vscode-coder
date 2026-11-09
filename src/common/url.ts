import * as vscode from "vscode";

import { parseDeploymentUrl, validateFilenameHostname } from "./validation";

/**
 * The URL's origin as a file- and SSH-safe label that keys per-deployment
 * storage: `scheme_host_port`, with an empty default port (`https_host_8443`,
 * `http_host_`). HTTPS on its default port keeps the bare hostname (`host`)
 * unless it contains `_`, so labels never collide.
 */
export function toSafeHost(rawUrl: string): string {
	const u = parseDeploymentUrl(rawUrl);
	// `URL` already lowercases and punycodes http(s) hostnames.
	const hostname = validateFilenameHostname(u.hostname);
	if (u.protocol === "https:" && !u.port && !hostname.includes("_")) {
		return hostname;
	}
	return `${u.protocol.slice(0, -1)}_${hostname}_${u.port}`;
}

export function removeTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, "");
}

/** True when both URLs share a scheme, host, and port. */
export function isSameOrigin(a: string, b: string): boolean {
	try {
		const originA = new URL(a).origin;
		const originB = new URL(b).origin;
		// "null" means an opaque origin, which is never comparable.
		return originA !== "null" && originA === originB;
	} catch {
		return false;
	}
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

/**
 * Converts params to a query string. Returns empty string if no params,
 * otherwise returns params prefixed with '?'.
 */
export function getQueryString(
	params: Record<string, string> | URLSearchParams | undefined,
): string {
	if (!params) {
		return "";
	}
	const searchParams =
		params instanceof URLSearchParams ? params : new URLSearchParams(params);
	const str = searchParams.toString();
	return str ? `?${str}` : "";
}
