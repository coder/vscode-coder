/** DOM builders shared by the vanilla webviews. */

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
