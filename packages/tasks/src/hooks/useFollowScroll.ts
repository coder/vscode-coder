import { useEffect, useRef, type RefObject } from "react";

const BOTTOM_THRESHOLD = 8;

/**
 * VscodeScrollable exposes these properties on its DOM element,
 * but they aren't in the TypeScript definitions.
 */
interface ScrollableElement extends HTMLElement {
	scrollPos: number;
	scrollMax: number;
}

function isScrollableElement(el: Element): el is ScrollableElement {
	return el.tagName === "VSCODE-SCROLLABLE";
}

/**
 * Keeps a scroll container following new content at the bottom.
 * Attach the returned ref to a sentinel div at the end of scrollable content.
 *
 * Works with both VscodeScrollable (using its scrollPos/scrollMax API and
 * vsc-scrollable-scroll event) and plain scrollable divs.
 */
export function useFollowScroll(): RefObject<HTMLDivElement | null> {
	const ref = useRef<HTMLDivElement>(null);
	const atBottom = useRef(true);

	useEffect(() => {
		const sentinel = ref.current;
		const container = sentinel?.parentElement;
		if (!sentinel || !container) return;

		const isVscodeScrollable = isScrollableElement(container);

		function isNearBottom(): boolean {
			if (isVscodeScrollable) {
				const el = container;
				return el.scrollMax - el.scrollPos <= BOTTOM_THRESHOLD;
			}
			return (
				container!.scrollHeight -
					container!.scrollTop -
					container!.clientHeight <=
				BOTTOM_THRESHOLD
			);
		}

		function scrollToBottom() {
			if (isVscodeScrollable) {
				const el = container;
				el.scrollPos = el.scrollMax;
			} else {
				container!.scrollTop = container!.scrollHeight;
			}
		}

		function onScroll() {
			atBottom.current = isNearBottom();
		}

		// VscodeScrollable emits a custom event; plain divs use native scroll.
		const scrollEvent = isVscodeScrollable ? "vsc-scrollable-scroll" : "scroll";
		container.addEventListener(scrollEvent, onScroll, { passive: true });

		// Auto-scroll when new children are added and the user was at the bottom.
		const mo = new MutationObserver(() => {
			if (atBottom.current) {
				scrollToBottom();
			}
		});
		mo.observe(container, { childList: true });

		// Initial scroll: wait until the container has layout, then scroll to bottom.
		const ro = new ResizeObserver(() => {
			if (container.clientHeight > 0) {
				scrollToBottom();
				ro.disconnect();
			}
		});
		ro.observe(container);

		return () => {
			container.removeEventListener(scrollEvent, onScroll);
			mo.disconnect();
			ro.disconnect();
		};
	}, []);

	return ref;
}
