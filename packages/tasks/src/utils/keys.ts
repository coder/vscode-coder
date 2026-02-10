interface KeyboardEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
}

export function isSubmit(e: KeyboardEvent): boolean {
	return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

export function isActivate(e: KeyboardEvent): boolean {
	return e.key === "Enter" || e.key === " ";
}

export function isEscape(e: KeyboardEvent): boolean {
	return e.key === "Escape";
}
