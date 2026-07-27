import { type ChangeEvent, type ComponentProps, useRef } from "react";

import { cx } from "#cx";

import "../control.css";
import { Icon } from "../Icon/Icon";
import { IconButton } from "../IconButton/IconButton";

import "./SearchInput.css";

export interface SearchInputProps extends Omit<
	ComponentProps<"input">,
	"aria-label" | "onChange" | "type" | "value"
> {
	clearLabel?: string;
	label?: string;
	onChange: (value: string) => void;
	value: string;
}

export function SearchInput({
	clearLabel = "Clear search",
	label = "Search",
	value,
	onChange,
	className,
	style,
	disabled,
	ref,
	...props
}: SearchInputProps): React.JSX.Element {
	const inputRef = useRef<HTMLInputElement>(null);
	const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
		onChange(event.currentTarget.value);
	};
	const handleClear = (): void => {
		onChange("");
		inputRef.current?.focus();
	};

	return (
		<div
			className={cx(
				"ui-control",
				"ui-search-input",
				disabled && "ui-search-input--disabled",
				className,
			)}
			style={style}
		>
			<Icon name="search" />
			<input
				{...props}
				// Track the node for clear-and-refocus, honoring the consumer ref
				ref={(node) => {
					inputRef.current = node;
					if (typeof ref === "function") {
						return ref(node);
					}
					if (ref) {
						ref.current = node;
					}
				}}
				type="search"
				value={value}
				onChange={handleChange}
				disabled={disabled}
				aria-label={label}
				className="ui-search-input__control"
			/>
			{value.length > 0 && !disabled ? (
				<IconButton
					icon="close"
					label={clearLabel}
					className="ui-search-input__clear"
					onClick={handleClear}
				/>
			) : null}
		</div>
	);
}
