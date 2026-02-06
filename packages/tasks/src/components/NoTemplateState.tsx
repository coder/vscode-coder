import { VscodeIcon } from "@vscode-elements/react-elements";

import { StatePanel } from "./StatePanel";

const DOCS_URL = "https://coder.com/docs/admin/templates";

export function NoTemplateState() {
	return (
		<StatePanel
			title="No Task template found"
			action={
				<a href={DOCS_URL} className="text-link">
					Learn how to create a template <VscodeIcon name="link-external" />
				</a>
			}
		/>
	);
}
