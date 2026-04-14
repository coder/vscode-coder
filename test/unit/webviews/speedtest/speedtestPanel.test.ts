import { describe, expect, it } from "vitest";

import { buildCommandHandlers, SpeedtestApi } from "@repo/shared";

describe("SpeedtestApi", () => {
	it("defines typed command handlers via buildCommandHandlers", async () => {
		let receivedData: string | undefined;

		const handlers = buildCommandHandlers(SpeedtestApi, {
			viewJson(data: string) {
				receivedData = data;
			},
		});

		// Handler is keyed by the wire method name
		expect(handlers[SpeedtestApi.viewJson.method]).toBeDefined();

		// Dispatching through the handler passes the data correctly
		await handlers[SpeedtestApi.viewJson.method]('{"test": true}');
		expect(receivedData).toBe('{"test": true}');
	});

	it("uses consistent method names for notification and command", () => {
		expect(SpeedtestApi.data.method).toBe("speedtest/data");
		expect(SpeedtestApi.viewJson.method).toBe("speedtest/viewJson");
	});
});
