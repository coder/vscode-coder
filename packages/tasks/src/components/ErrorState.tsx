import { VscodeButton } from "@vscode-elements/react-elements";

import { StatePanel } from "./StatePanel";

interface ErrorStateProps {
	message: string;
	onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
	return (
		<StatePanel
			className="error-state"
			icon={<span className="codicon codicon-error error-icon" />}
			description={message}
			action={<VscodeButton onClick={onRetry}>Retry</VscodeButton>}
		/>
	);
}
