import { postMessage, useMessage } from "@repo/webview-shared/react";
import {
	VscodeButton,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";
import { useCallback, useEffect, useState } from "react";

import type { WebviewMessage } from "@repo/webview-shared";

export default function App() {
	const [ready, setReady] = useState(false);

	const handleMessage = useCallback((message: WebviewMessage) => {
		switch (message.type) {
			case "init":
				setReady(true);
				break;
		}
	}, []);

	useMessage(handleMessage);

	useEffect(() => {
		postMessage({ type: "ready" });
	}, []);

	if (!ready) {
		return <VscodeProgressRing />;
	}

	return (
		<div>
			<h2>Coder Tasks</h2>
			<VscodeButton onClick={() => postMessage({ type: "refresh" })}>
				Refresh
			</VscodeButton>
		</div>
	);
}
