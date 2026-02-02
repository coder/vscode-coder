import { Component, type ReactNode } from "react";

import { logger } from "../logger";

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * Catches errors in child components and displays a fallback UI.
 */
export class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	override state: ErrorBoundaryState = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
		logger.error("Webview error:", error, errorInfo);
	}

	override render(): ReactNode {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div style={{ padding: 16, color: "var(--vscode-errorForeground)" }}>
						<strong>Something went wrong</strong>
						<pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
							{this.state.error?.message}
						</pre>
					</div>
				)
			);
		}
		return this.props.children;
	}
}
