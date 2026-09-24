import { ErrorBoundary } from "@repo/webview-shared/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (!root) {
	throw new Error(
		"Failed to find root element. The webview HTML must contain an element with id='root'.",
	);
}

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<ErrorBoundary>
				<App />
			</ErrorBoundary>
		</QueryClientProvider>
	</StrictMode>,
);
