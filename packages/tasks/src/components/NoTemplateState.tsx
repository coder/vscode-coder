import { VscodeIcon } from "@vscode-elements/react-elements";

const DOCS_URL = "https://coder.com/docs/admin/templates";

export function NoTemplateState() {
	return (
		<div className="centered-state">
			<p className="centered-state-title">No Task template found</p>
			<a
				href={DOCS_URL}
				target="_blank"
				rel="noopener noreferrer"
				className="text-link"
			>
				Learn how to create a template <VscodeIcon name="link-external" />
			</a>
		</div>
	);
}
