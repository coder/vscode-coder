import { useState } from "react";

import { IconButton } from "../IconButton/IconButton";
import { Input, type InputProps } from "../Input/Input";

export interface PasswordInputProps extends Omit<
	InputProps,
	"children" | "type"
> {
	hideValueLabel?: string;
	showValueLabel?: string;
}

/* A masked Input with a reveal toggle, styled like the find widget's
   in-field option buttons. */
export function PasswordInput({
	showValueLabel = "Show value",
	hideValueLabel = "Hide value",
	disabled,
	...props
}: PasswordInputProps): React.JSX.Element {
	const [revealed, setRevealed] = useState(false);
	return (
		<Input {...props} type={revealed ? "text" : "password"} disabled={disabled}>
			<IconButton
				className="ui-text-control__action"
				icon={revealed ? "eye-closed" : "eye"}
				label={revealed ? hideValueLabel : showValueLabel}
				aria-pressed={revealed}
				disabled={disabled}
				onClick={() => setRevealed(!revealed)}
			/>
		</Input>
	);
}
