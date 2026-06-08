/**
 * Normalizes request and websocket routes into low-cardinality telemetry
 * labels. Drops the query/fragment (which can carry tokens) and bounds
 * cardinality by collapsing ids and bucketing unmatched routes, so even an
 * unseen route is safe to emit.
 */

const UNKNOWN_ROUTE = "<unknown>";
const ID_PLACEHOLDER = "{id}";
const NAME_PLACEHOLDER = "{name}";
/** Tail marker for routes with no matching template. */
const BUCKET_PLACEHOLDER = "{*}";
/** Segments kept verbatim before the bucket marker on unmatched routes. */
const UNMATCHED_PREFIX_SEGMENTS = 3;

/** Any-version UUID; version and variant nibbles are unenforced so UUIDv7 ids collapse too. */
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER_PATTERN = /^\d+$/;

/**
 * Templates refine name segments (usernames, workspace/template names) that
 * id collapsing misses. Precision only: a missing rule never risks
 * cardinality, since unmatched routes still collapse ids and bucket.
 */
const ROUTE_NORMALIZATION_RULES: ReadonlyArray<readonly string[]> = [
	"api/v2/users/{name}/workspace/{name}",
	"api/v2/users/{name}/keys/{id}",
	"api/v2/users/{name}",
	"api/v2/tasks/{name}/{id}",
	"api/v2/tasks/{name}",
	"api/v2/organizations/{id}/templates/{name}/versions/{name}",
	"api/v2/organizations/{id}/templates/{name}",
	"api/v2/organizations/{id}/groups/{name}",
	"api/v2/organizations/{id}/members/{name}",
	"api/v2/organizations/{id}",
	"api/v2/aibridge/sessions/{id}",
	"api/v2/files/{id}",
	"api/v2/groups/{id}",
	"api/v2/licenses/{id}",
	"api/v2/oauth2-provider/apps/{id}",
	"api/v2/templates/{id}",
	"api/v2/templateversions/{id}",
	"api/v2/workspaceagents/{id}",
	"api/v2/workspacebuilds/{id}",
	"api/v2/workspaces/{id}/builds/{id}",
	"api/v2/workspaces/{id}",
].map((rule) => rule.split("/"));

/**
 * Normalizes `url` (optionally resolved against `baseURL`) to a stable route
 * label. Returns `<unknown>` for missing or unparseable input.
 */
export function normalizeRoute(
	url: string | undefined,
	baseURL?: string,
): string {
	if (!url) {
		return UNKNOWN_ROUTE;
	}

	const segments = parsePathSegments(url, baseURL);
	if (segments.length === 0) {
		return UNKNOWN_ROUTE;
	}

	const collapsed = segments.map(collapseIdSegment);
	for (const rule of ROUTE_NORMALIZATION_RULES) {
		const normalized = normalizeByRule(collapsed, rule);
		if (normalized) {
			return normalized;
		}
	}
	return bucketUnmatchedRoute(collapsed);
}

/** Collapses UUID and integer segments to `{id}` to bound cardinality. */
function collapseIdSegment(segment: string): string {
	return UUID_PATTERN.test(segment) || INTEGER_PATTERN.test(segment)
		? ID_PLACEHOLDER
		: segment;
}

function normalizeByRule(
	segments: readonly string[],
	rule: readonly string[],
): string | undefined {
	if (segments.length < rule.length) {
		return undefined;
	}

	const normalized: string[] = [];
	for (const [index, ruleSegment] of rule.entries()) {
		if (ruleSegment === ID_PLACEHOLDER || ruleSegment === NAME_PLACEHOLDER) {
			normalized.push(ruleSegment);
			continue;
		}
		if (segments[index] !== ruleSegment) {
			return undefined;
		}
		normalized.push(segments[index]);
	}

	// Trailing segments pass through with ids already collapsed; add a rule
	// above if a tail can hold a name.
	return `/${[...normalized, ...segments.slice(rule.length)].join("/")}`;
}

/**
 * Bucket for unmatched routes: keep a short prefix and collapse the rest, so
 * unseen routes stay bounded even when their variable segments are names.
 */
function bucketUnmatchedRoute(segments: readonly string[]): string {
	if (segments.length <= UNMATCHED_PREFIX_SEGMENTS) {
		return `/${segments.join("/")}`;
	}
	const prefix = segments.slice(0, UNMATCHED_PREFIX_SEGMENTS).join("/");
	return `/${prefix}/${BUCKET_PLACEHOLDER}`;
}

/** Path segments only; `pathname` drops the query and fragment so tokens never reach telemetry. */
function parsePathSegments(url: string, baseURL?: string): string[] {
	try {
		return new URL(url, baseURL ?? "http://coder.invalid").pathname
			.split("/")
			.filter(Boolean);
	} catch {
		return [];
	}
}
