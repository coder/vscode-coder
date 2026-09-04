/** The DOM reads the data model cannot answer: what an event actually hit. */

/**
 * Anything focusable in a row owns its own clicks and keys. `[tabindex]` covers
 * the interactive ARIA roles: a role nothing can focus is one nothing can use.
 */
const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button",
	"input",
	"select",
	"textarea",
	"[contenteditable]:not([contenteditable='false'])",
	"[tabindex]:not([tabindex='-1'])",
].join(",");

/** The focusable element the event hit, unless that element is `container`. */
export function nestedInteractiveTarget(
	target: EventTarget | null,
	container: HTMLElement,
): Element | null {
	if (!(target instanceof Element) || target === container) {
		return null;
	}
	const focusable = target.closest(FOCUSABLE_SELECTOR);
	return focusable !== null &&
		focusable !== container &&
		container.contains(focusable)
		? focusable
		: null;
}

/** Whether a click landed on the twistie rather than the row body. */
export function hitTwistie(
	row: { readonly expanded: boolean | undefined },
	target: EventTarget | null,
): boolean {
	return (
		row.expanded !== undefined &&
		target instanceof Element &&
		target.closest(".ui-tree-item__chevron") !== null
	);
}

/** The row element the event hit, if any. */
export function closestRow(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element
		? target.closest<HTMLElement>("[data-tree-id]")
		: null;
}

export function scrollableAncestor(
	element: HTMLElement,
): HTMLElement | undefined {
	for (
		let parent = element.parentElement;
		parent !== null;
		parent = parent.parentElement
	) {
		const { overflowY } = getComputedStyle(parent);
		if (overflowY === "auto" || overflowY === "scroll") {
			return parent;
		}
	}
	return undefined;
}
