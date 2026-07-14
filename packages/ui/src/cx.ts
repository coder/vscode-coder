/** Joins the truthy class names, dropping conditional falsy entries. */
export function cx(...classes: Array<string | false | undefined>): string {
	return classes.filter(Boolean).join(" ");
}
