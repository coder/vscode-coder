import { useEffect, type RefObject } from "react";

/** Max share of the panel a section can claim via --section-flex-grow. */
const MAX_FLEX_RATIO = 0.5;

/**
 * Sets an explicit pixel height on a scrollable so VscodeScrollable can
 * compute scroll metrics, and writes a --section-flex-grow CSS custom
 * property on the host for content-adaptive sizing.
 */
export function useScrollableHeight(
	hostRef: RefObject<HTMLElement | null>,
	scrollRef: RefObject<HTMLElement | null>,
) {
	useEffect(() => {
		const host = hostRef.current;
		const scroll = scrollRef.current;
		if (!host || !scroll) {
			return;
		}

		const observer = new ResizeObserver(() => {
			if (!scroll.offsetParent) {
				scroll.style.height = "";
				return;
			}

			const hostRect = host.getBoundingClientRect();
			const scrollTop = scroll.getBoundingClientRect().top;
			const available = hostRect.bottom - scrollTop;
			scroll.style.height = available > 0 ? `${available}px` : "";

			const contentEl = scroll.firstElementChild as HTMLElement | null;
			const panel = host.parentElement;
			if (contentEl && panel && panel.clientHeight > 0) {
				const ratio = Math.min(
					(scrollTop - hostRect.top + contentEl.offsetHeight) /
						panel.clientHeight,
					MAX_FLEX_RATIO,
				);
				host.style.setProperty(
					"--section-flex-grow",
					(ratio / (1 - ratio)).toFixed(3),
				);
			}
		});

		observer.observe(host);
		observer.observe(scroll);

		return () => observer.disconnect();
	}, [hostRef, scrollRef]);
}
