/** DOM builders shared by the vanilla webviews. */

/** A page header: an eyebrow label above a title with the given class. */
export function pageHeader(
	eyebrow: string,
	title: string,
	titleClass: string,
): HTMLElement {
	const header = document.createElement("header");
	header.className = "page-header";
	const eyebrowEl = document.createElement("p");
	eyebrowEl.className = "eyebrow";
	eyebrowEl.textContent = eyebrow;
	const titleEl = document.createElement("h1");
	titleEl.className = titleClass;
	titleEl.textContent = title;
	header.append(eyebrowEl, titleEl);
	return header;
}

/** An action bar with a "View JSON" button wired to `onClick`. */
export function viewJsonAction(onClick: () => void): HTMLElement {
	const actions = document.createElement("div");
	actions.className = "actions";
	const button = document.createElement("button");
	button.textContent = "View JSON";
	button.addEventListener("click", onClick);
	actions.append(button);
	return actions;
}

/** A message shown in place of a section or result that has no data. */
export function emptyMessage(text: string): HTMLElement {
	return paragraph("empty", text);
}

/** A top-level failure message. */
export function errorMessage(text: string): HTMLElement {
	return paragraph("error", text);
}

function paragraph(className: string, text: string): HTMLElement {
	const p = document.createElement("p");
	p.className = className;
	p.textContent = text;
	return p;
}
