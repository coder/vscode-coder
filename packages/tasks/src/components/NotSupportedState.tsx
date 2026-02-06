import { VscodeIcon } from "@vscode-elements/react-elements";

import { StatePanel } from "./StatePanel";

const DOCS_URL = "https://coder.com/docs/tasks";

export function NotSupportedState() {
	return (
		<StatePanel
			icon={<VscodeIcon name="warning" />}
			title="Tasks not available"
			description="This Coder server does not support tasks."
			action={
				<a href={DOCS_URL} className="text-link">
					Learn more <VscodeIcon name="link-external" />
				</a>
			}
		/>
	);
}
