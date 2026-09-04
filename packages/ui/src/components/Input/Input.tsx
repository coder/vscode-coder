import { type ChangeEvent, type ComponentProps, useState } from "react";

import { cx } from "#cx";

import "../control.css";
import { IconButton } from "../IconButton/IconButton";

import "./Input.css";

export interface InputProps extends Omit<
	ComponentProps<"input">,
	"onChange" | "value"
> {
	hideLabel?: string;
	onChange: (value: string) => void;
	showLabel?: string;
	value: string;
}

/* A password input renders a reveal toggle, styled like the find widget's
   in-field option buttons. */
export function Input({
	value,
	onChange,
	className,
	style,
	disabled,
	type = "text",
	showLabel = "Show value",
	hideLabel = "Hide value",
	...props
}: InputProps): React.JSX.Element {
	const [revealed, setRevealed] = useState(false);
	const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
		onChange(event.currentTarget.value);
	};

	return (
		<div
			className={cx(
				"ui-control",
				"ui-input",
				disabled && "ui-input--disabled",
				className,
			)}
			style={style}
		>
			<input
				{...props}
				type={type === "password" && revealed ? "text" : type}
				value={value}
				onChange={handleChange}
				disabled={disabled}
				className="ui-input__control"
			/>
			{type === "password" && (
				<IconButton
					className="ui-input__reveal"
					icon={revealed ? "eye-closed" : "eye"}
					label={revealed ? hideLabel : showLabel}
					aria-pressed={revealed}
					disabled={disabled}
					onClick={() => setRevealed(!revealed)}
				/>
			)}
		</div>
	);
}
