import { VscodeScrollable } from "@vscode-elements/react-elements";

import { useFollowScroll } from "../hooks/useFollowScroll";

import type { ReactNode } from "react";

interface LogViewerProps {
	header: string;
	children: ReactNode;
}

export function LogViewer({ header, children }: LogViewerProps) {
	const bottomRef = useFollowScroll();

	return (
		<div className="log-viewer">
			<div className="log-viewer-header">{header}</div>
			<VscodeScrollable className="log-viewer-content">
				{children}
				<div ref={bottomRef} />
			</VscodeScrollable>
		</div>
	);
}

export function LogViewerPlaceholder({
	children,
	error,
}: {
	children: string;
	error?: boolean;
}) {
	return (
		<div className={`log-viewer-empty${error ? " log-viewer-error" : ""}`}>
			{children}
		</div>
	);
}
