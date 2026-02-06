import { VscodeButton, VscodeIcon } from "@vscode-elements/react-elements";

import { StatePanel } from "./StatePanel";

interface ErrorStateProps {
	message: string;
	onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
	return (
		<StatePanel
			className="error-state"
			icon={<VscodeIcon name="error" className="error-icon" />}
			description={message}
			action={<VscodeButton onClick={onRetry}>Retry</VscodeButton>}
		/>
	);
}
