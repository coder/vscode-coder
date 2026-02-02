import { logger } from "@repo/webview-shared/logger";
import { useMessage } from "@repo/webview-shared/react";
import {
	VscodeButton,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";
import { useEffect, useState } from "react";

import { sendReady, sendRefresh } from "./messages";

import type { TasksExtensionMessage } from "@repo/webview-shared";

export default function App() {
	const [ready, setReady] = useState(false);

	useMessage<TasksExtensionMessage>((message) => {
		switch (message.type) {
			case "init":
				setReady(true);
				break;
			case "error":
				logger.error("Tasks panel error:", message.data);
				break;
		}
	});

	useEffect(() => {
		sendReady();
	}, []);

	if (!ready) {
		return <VscodeProgressRing />;
	}

	return (
		<div>
			<h2>Coder Tasks</h2>
			<VscodeButton onClick={sendRefresh}>Refresh</VscodeButton>
		</div>
	);
}
