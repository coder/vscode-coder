import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { Inbox } from "@/inbox";

import {
	MockConfigurationProvider,
	MockEventStream,
	createMockLogger,
} from "../mocks/testHelpers";
import { workspace as createWorkspace } from "../mocks/workspace";

import type { GetInboxNotificationResponse } from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";

function createNotification(title: string): GetInboxNotificationResponse {
	return {
		notification: {
			id: "notif-1",
			user_id: "user-1",
			template_id: "template-1",
			targets: ["workspace-1"],
			title,
			content: "",
			icon: "",
			actions: [],
			read_at: null,
			created_at: new Date().toISOString(),
		},
		unread_count: 1,
	};
}

function createMockClient(
	stream: MockEventStream<GetInboxNotificationResponse>,
) {
	return {
		watchInboxNotifications: vi.fn().mockResolvedValue(stream.stream),
	} as unknown as CoderApi;
}

describe("Inbox", () => {
	let config: MockConfigurationProvider;

	beforeEach(() => {
		vi.resetAllMocks();
		config = new MockConfigurationProvider();
	});

	async function createInbox(
		stream = new MockEventStream<GetInboxNotificationResponse>(),
	) {
		const ws = createWorkspace();
		const client = createMockClient(stream);
		const inbox = await Inbox.create(ws, client, createMockLogger());
		return { inbox, stream };
	}

	describe("message handling", () => {
		it("shows notification when a message arrives", async () => {
			const { inbox, stream } = await createInbox();

			stream.pushMessage(createNotification("Out of memory"));

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"Out of memory",
			);
			inbox.dispose();
		});

		it("shows multiple notifications for successive messages", async () => {
			const { inbox, stream } = await createInbox();

			stream.pushMessage(createNotification("First alert"));
			stream.pushMessage(createNotification("Second alert"));

			expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
			inbox.dispose();
		});

		it("logs parse errors without showing notifications", async () => {
			const { inbox, stream } = await createInbox();

			stream.pushError(new Error("bad json"));

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
			inbox.dispose();
		});

		it("closes the socket on dispose", async () => {
			const stream = new MockEventStream<GetInboxNotificationResponse>();
			const { inbox } = await createInbox(stream);
			inbox.dispose();

			expect(stream.stream.close).toHaveBeenCalled();
		});
	});

	describe("disableNotifications", () => {
		it("suppresses notifications when enabled", async () => {
			config.set("coder.disableNotifications", true);
			const { inbox, stream } = await createInbox();

			stream.pushMessage(createNotification("Out of memory"));

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
			inbox.dispose();
		});

		it("shows notifications after re-enabling", async () => {
			config.set("coder.disableNotifications", true);
			const { inbox, stream } = await createInbox();

			stream.pushMessage(createNotification("suppressed"));
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

			config.set("coder.disableNotifications", false);

			stream.pushMessage(createNotification("visible"));
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"visible",
			);
			inbox.dispose();
		});
	});
});
