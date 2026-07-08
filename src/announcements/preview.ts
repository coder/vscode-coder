import * as vscode from "vscode";

const SCHEME = "coder-announcements";
// No .md extension: the preview renders content as markdown regardless.
const URI = vscode.Uri.parse(`${SCHEME}:Coder Announcements`);

/** Shows deployment announcements in VS Code's built-in Markdown Preview. */
export class AnnouncementsPreview implements vscode.Disposable {
	private markdown = "";
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
	private readonly providerDisposable =
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
			onDidChange: this.changeEmitter.event,
			provideTextDocumentContent: () => this.markdown,
		});

	/** Opens (or refreshes, if already open) the preview tab with new content. */
	public async show(markdown: string): Promise<void> {
		this.markdown = markdown;
		this.changeEmitter.fire(URI);
		await vscode.commands.executeCommand("markdown.showPreview", URI);
	}

	public dispose(): void {
		this.changeEmitter.dispose();
		this.providerDisposable.dispose();
	}
}
