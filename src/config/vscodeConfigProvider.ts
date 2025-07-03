import * as vscode from "vscode";
import { ConfigProvider } from "../logger";

export class VSCodeConfigProvider implements ConfigProvider {
	getVerbose(): boolean {
		const config = vscode.workspace.getConfiguration("coder");
		return config.get<boolean>("verbose", false);
	}

	onVerboseChange(callback: () => void): { dispose: () => void } {
		const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("coder.verbose")) {
				callback();
			}
		});
		return disposable;
	}
}
