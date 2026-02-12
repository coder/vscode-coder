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
	actionIcon: "send" | "debug-pause";
	actionLabel: string;
	actionDisabled: boolean;
}

export function PromptInput({
	value,
	onChange,
	onSubmit,
	disabled = false,
	loading = false,
	placeholder = "Prompt your AI agent to start a task...",
	actionIcon,
	actionLabel,
	actionDisabled,
}: PromptInputProps) {
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
						if (!actionDisabled) {
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
						name={actionIcon}
						label={actionLabel}
						onClick={() => !actionDisabled && onSubmit()}
						className={actionDisabled ? "disabled" : ""}
					/>
				)}
			</div>
		</div>
	);
}
