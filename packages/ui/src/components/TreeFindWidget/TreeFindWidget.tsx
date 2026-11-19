import { type ComponentProps, type Ref } from "react";

import { cx } from "#cx";

import { IconButton } from "../IconButton/IconButton";
import { Input } from "../Input/Input";

import "./TreeFindWidget.css";

export interface TreeFindWidgetProps extends Omit<
	ComponentProps<"div">,
	"onChange" | "ref"
> {
	value: string;
	onChange: (value: string) => void;
	/** Escape and the close button. */
	onClose: () => void;
	/** Enter and Arrow Down, which hand focus back to the list like native. */
	onFocusList?: () => void;
	/** The input's accessible name and placeholder, as in native. */
	label?: string;
	/** The input, like `SearchInput`, so a consumer can refocus it. */
	ref?: Ref<HTMLInputElement>;
}

/**
 * VS Code's tree find widget, floating at the top right of the nearest
 * positioned ancestor. Place it outside the scrolling element, or in a
 * sticky one, so it stays put while the list scrolls. It takes focus when
 * it mounts.
 */
export function TreeFindWidget({
	value,
	onChange,
	onClose,
	onFocusList,
	label = "Type to search",
	ref,
	className,
	...props
}: TreeFindWidgetProps): React.JSX.Element {
	return (
		<div {...props} className={cx("ui-tree-find-widget", className)}>
			<Input
				ref={ref}
				type="search"
				aria-label={label}
				placeholder={label}
				value={value}
				onChange={onChange}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onClose();
					} else if (event.key === "Enter" || event.key === "ArrowDown") {
						event.preventDefault();
						onFocusList?.();
					}
				}}
				className="ui-tree-find-widget__input"
				autoFocus
			/>
			<IconButton
				icon="close"
				label="Close"
				onClick={onClose}
				className="ui-tree-find-widget__close"
			/>
		</div>
	);
}
