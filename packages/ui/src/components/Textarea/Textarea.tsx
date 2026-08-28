import { type ChangeEvent, type ComponentProps } from "react";

import { cx } from "#cx";

import "./Textarea.css";

export interface TextareaProps extends Omit<
	ComponentProps<"textarea">,
	"onChange" | "value"
> {
	onChange: (value: string) => void;
	value: string;
}

export function Textarea({
	value,
	onChange,
	className,
	...props
}: TextareaProps): React.JSX.Element {
	const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
		onChange(event.currentTarget.value);
	};

	return (
		<textarea
			{...props}
			value={value}
			onChange={handleChange}
			className={cx("ui-textarea", className)}
		/>
	);
}
