import {
	VscodeIcon,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";

import { isSubmit } from "../utils/keys";

interface PromptInputProps {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	disabled?: boolean;
	loading?: boolean;
	placeholder?: string;
}

export function PromptInput({
	value,
	onChange,
	onSubmit,
	disabled = false,
	loading = false,
	placeholder = "Prompt your AI agent to start a task...",
}: PromptInputProps) {
	const canSubmit = value.trim().length > 0 && !disabled && !loading;

	return (
		<div className="prompt-input-container">
			<textarea
				className="prompt-input"
				placeholder={placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (isSubmit(e)) {
						e.preventDefault();
						if (canSubmit) {
							onSubmit();
						}
					}
				}}
				disabled={disabled || loading}
			/>
			<div className="prompt-send-button">
				{loading ? (
					<VscodeProgressRing />
				) : (
					<VscodeIcon
						actionIcon
						name="send"
						label="Send"
						onClick={() => canSubmit && onSubmit()}
						className={canSubmit ? "" : "disabled"}
					/>
				)}
			</div>
		</div>
	);
}
