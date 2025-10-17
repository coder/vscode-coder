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
