import { beforeEach, vi } from "vitest";
import * as vscode from "vscode";

import { LocalProxySettings } from "@/settings/proxy";

// The service container creates this on activation; tests skip the container.
beforeEach(() => {
	vi.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce({
		get: vi.fn(),
		has: vi.fn(),
		inspect: vi.fn(),
		update: vi.fn(),
	});
	const settings = LocalProxySettings.initialize();
	return () => settings.dispose();
});
