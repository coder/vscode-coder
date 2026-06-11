/** Create an element with an optional class and text content. */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) {
		node.className = className;
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
}

export function badge(text: string): HTMLElement {
	return el("span", "badge", text);
}

export function emptyMessage(text: string): HTMLElement {
	return el("p", "empty", text);
}
