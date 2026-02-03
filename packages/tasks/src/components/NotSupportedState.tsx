import { VscodeIcon } from "@vscode-elements/react-elements";

const DOCS_URL = "https://coder.com/docs/tasks";

export function NotSupportedState() {
	return (
		<div className="centered-state">
			<VscodeIcon name="warning" />
			<p className="centered-state-title">Tasks not available</p>
			<p className="centered-state-description">
				This Coder server does not support tasks.
			</p>
			<a
				href={DOCS_URL}
				target="_blank"
				rel="noopener noreferrer"
				className="text-link"
			>
				Learn more <VscodeIcon name="link-external" />
			</a>
		</div>
	);
}
