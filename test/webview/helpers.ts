/**
 * Like querySelector, but throws if no element matches.
 * Use this instead of `querySelector(...)!` so tests fail with a clear message.
 */
export function qs<T extends Element = Element>(
	container: ParentNode,
	selector: string,
): T {
	const el = container.querySelector<T>(selector);
	if (!el) {
		throw new Error(`No element found for selector: ${selector}`);
	}
	return el;
}
