import { useEffect, useRef, type RefObject } from "react";

const BOTTOM_THRESHOLD = 8;

/**
 * VscodeScrollable exposes these properties on its DOM element,
 * but they aren't in the TypeScript definitions for this package.
 */
interface ScrollableElement extends HTMLElement {
	scrollPos: number;
	scrollMax: number;
}

/**
 * Keeps a VscodeScrollable container following new content at the bottom.
 * Attach the returned ref to a sentinel div at the end of scrollable content.
 */
export function useFollowScroll(): RefObject<HTMLDivElement | null> {
	const ref = useRef<HTMLDivElement>(null);
	const atBottom = useRef(true);

	useEffect(() => {
		const sentinel = ref.current;
		const parent = sentinel?.parentElement;
		if (!sentinel || parent?.tagName !== "VSCODE-SCROLLABLE") {
			return;
		}
		const container = parent as ScrollableElement;

		function onScroll() {
			atBottom.current =
				container.scrollMax - container.scrollPos <= BOTTOM_THRESHOLD;
		}

		function scrollToBottom() {
			container.scrollPos = container.scrollMax;
		}

		container.addEventListener("vsc-scrollable-scroll", onScroll, {
			passive: true,
		});

		const mo = new MutationObserver(() => {
			if (atBottom.current) {
				scrollToBottom();
			}
		});
		mo.observe(container, { childList: true });

		// VscodeScrollable computes scrollMax asynchronously, so we wait
		// for layout before performing the initial scroll.
		const ro = new ResizeObserver(() => {
			if (container.clientHeight > 0) {
				scrollToBottom();
				ro.disconnect();
			}
		});
		ro.observe(container);

		return () => {
			container.removeEventListener("vsc-scrollable-scroll", onScroll);
			mo.disconnect();
			ro.disconnect();
		};
	}, []);

	return ref;
}
