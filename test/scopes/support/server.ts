import { isAxiosError } from "axios";
import { Api } from "coder/site/src/api/api";
import { text } from "node:stream/consumers";
import WebSocket from "ws";

export const PASSWORD = "SomeLongPassw0rd!";

/** A REST client whose errors name the request and the server's reason. */
export function createClient(url: string, token?: string): Api {
	const api = new Api();
	api.setHost(url);
	if (token) {
		api.setSessionToken(token);
	}
	api
		.getAxiosInstance()
		.interceptors.response.use(undefined, (error: unknown) => {
			if (
				isAxiosError<{ message?: string; detail?: string }>(error) &&
				error.response
			) {
				const { config, response } = error;
				const reason = [response.data?.message, response.data?.detail]
					.filter(Boolean)
					.join(": ");
				error.message = `${config?.method?.toUpperCase()} ${config?.url}: ${response.status} ${reason}`;
			}
			throw error;
		});
	return api;
}

export async function signIn(api: Api, email: string): Promise<Api> {
	const { session_token } = await api.login(email, PASSWORD);
	api.setSessionToken(session_token);
	return api;
}

/** Opens a socket to `path`, absolute or relative to the API's host, as the API's user. */
export function openSocket(api: Api, path: string): WebSocket {
	const url = new URL(path, api.getAxiosInstance().defaults.baseURL);
	url.protocol = url.protocol.replace("http", "ws");
	return new WebSocket(url, {
		headers: { "Coder-Session-Token": api.getSessionToken() ?? "" },
	});
}

/** Resolves once the socket opens; rejects with the response if the server refuses it. */
export function awaitOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("unexpected-response", (_request, response) => {
			void text(response).then(
				(body) =>
					reject(
						new Error(`GET ${socket.url}: ${response.statusCode} ${body}`),
					),
				reject,
			);
		});
		socket.once("error", reject);
	});
}
