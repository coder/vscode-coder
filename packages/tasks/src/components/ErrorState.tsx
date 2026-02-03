import { VscodeButton } from "@vscode-elements/react-elements";

interface ErrorStateProps {
	message: string;
	onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
	return (
		<div className="centered-state">
			<span className="codicon codicon-error error-icon" />
			<p className="error-message">{message}</p>
			<VscodeButton onClick={onRetry}>Retry</VscodeButton>
		</div>
	);
}
