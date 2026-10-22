import * as assert from "assert";
import * as vscode from "vscode";

import { createHttpAgent } from "../../src/api/httpAgent";
import { applySshEnvironment } from "../../src/remote/environment";

import type { ClientRequest } from "node:http";

const API_URL = "https://coder.example.com";
const PROXY_URL = "http://proxy.example.com:3128";

// The extension doesn't expose its context, and the terminal side of the SSH
// environment isn't under test.
const envCollection = {
	persistent: false,
	replace: () => undefined,
	clear: () => undefined,
};

suite("Proxy", () => {
	test("API requests stop using http.proxy once it is removed mid-session", async () => {
		const inherited = await proxyForApi();
		await setHttpProxy(PROXY_URL);
		const sshEnvironment = applySshEnvironment(
			vscode.workspace.getConfiguration(),
			envCollection,
		);

		try {
			assert.strictEqual(await proxyForApi(), PROXY_URL);

			await setHttpProxy(undefined);
			assert.strictEqual(process.env.HTTPS_PROXY, PROXY_URL);
			assert.strictEqual(await proxyForApi(), inherited);
		} finally {
			sshEnvironment.dispose();
			await setHttpProxy(undefined);
		}
	});
});

async function proxyForApi(): Promise<string> {
	const agent = await createHttpAgent(vscode.workspace.getConfiguration());
	// Our getProxyForUrl wrapper only uses the URL, not the request.
	return agent.getProxyForUrl(API_URL, {} as ClientRequest);
}

async function setHttpProxy(value: string | undefined): Promise<void> {
	await vscode.workspace
		.getConfiguration()
		.update("http.proxy", value, vscode.ConfigurationTarget.Global);
}
