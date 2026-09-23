import type { CSSProperties } from "react";

/** Joins the truthy class names, dropping conditional falsy entries. */
export function cx(...classes: Array<string | false | undefined>): string {
	return classes.filter(Boolean).join(" ");
}

/** Narrows a part's `className` and `style` to the plain values `cx` takes. */
export type Styled<P> = Omit<P, "className" | "style"> & {
	className?: string;
	style?: CSSProperties;
};
