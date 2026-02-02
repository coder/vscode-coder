import { ErrorBoundary } from "@repo/webview-shared/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error(
		"Failed to find root element. The webview HTML must contain an element with id='root'.",
	);
}

createRoot(root).render(
	<StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</StrictMode>,
);
