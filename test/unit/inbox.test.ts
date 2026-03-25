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

describe("Inbox", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	async function setup(
		stream = new MockEventStream<GetInboxNotificationResponse>(),
	) {
		const config = new MockConfigurationProvider();
		const inbox = await Inbox.create(
			createWorkspace(),
			{
				watchInboxNotifications: () => Promise.resolve(stream),
			} as unknown as CoderApi,
			createMockLogger(),
		);
		return { inbox, stream, config };
	}

	describe("message handling", () => {
		it("shows notification with the message title", async () => {
			const { stream } = await setup();

			stream.pushMessage(createNotification("Out of memory"));

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"Out of memory",
			);
		});

		it("shows each notification independently (no dedup)", async () => {
			const { stream } = await setup();

			stream.pushMessage(createNotification("First alert"));
			stream.pushMessage(createNotification("Second alert"));

			expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
		});

		it("logs parse errors without showing notifications", async () => {
			const { stream } = await setup();

			stream.pushError(new Error("bad json"));

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});

		it("closes the socket on dispose", async () => {
			const stream = new MockEventStream<GetInboxNotificationResponse>();
			const { inbox } = await setup(stream);

			inbox.dispose();

			expect(stream.close).toHaveBeenCalled();
		});
	});

	describe("disableNotifications", () => {
		it("suppresses notifications when enabled", async () => {
			const { stream, config } = await setup();
			config.set("coder.disableNotifications", true);

			stream.pushMessage(createNotification("Out of memory"));

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});

		it("shows notifications after re-enabling", async () => {
			const { stream, config } = await setup();
			config.set("coder.disableNotifications", true);

			stream.pushMessage(createNotification("suppressed"));
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

			config.set("coder.disableNotifications", false);

			stream.pushMessage(createNotification("visible"));
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"visible",
			);
		});
	});
});
