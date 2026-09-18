import axiosClient from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DynamicUpdateSession } from "@/api/dynamicUpdateSession";

import type {
	DynamicParametersResponse,
	PreviewParameter,
	Workspace,
	WorkspaceBuild,
	WorkspaceBuildParameter,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";

function build(overrides: Partial<WorkspaceBuild> = {}): WorkspaceBuild {
	return {
		id: "source-build",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		workspace_id: "workspace-id",
		workspace_name: "workspace",
		workspace_owner_id: "owner-id",
		workspace_owner_name: "owner",
		template_version_id: "old-version",
		template_version_name: "old",
		build_number: 1,
		transition: "start",
		initiator_id: "user-id",
		initiator_name: "user",
		job: { status: "succeeded" } as WorkspaceBuild["job"],
		reason: "dashboard",
		resources: [],
		status: "running",
		daily_cost: 0,
		template_version_preset_id: null,
		...overrides,
	};
}

function workspace(latest_build = build()): Workspace {
	return {
		id: "workspace-id",
		owner_id: "owner-id",
		owner_name: "owner",
		name: "workspace",
		template_active_version_id: "target-version",
		latest_build,
	} as Workspace;
}

function parameter(
	name: string,
	overrides: Partial<PreviewParameter> = {},
): PreviewParameter {
	return {
		name,
		display_name: name,
		description: "",
		type: "string",
		form_type: "",
		styling: {},
		mutable: true,
		default_value: { valid: false, value: "" },
		icon: "",
		options: [],
		validations: [],
		required: false,
		order: 0,
		ephemeral: false,
		value: { valid: true, value: "" },
		diagnostics: [],
		...overrides,
	};
}

function evaluation(
	parameters: readonly PreviewParameter[],
): DynamicParametersResponse {
	return { id: 0, diagnostics: [], parameters };
}

function response<T>(data: T) {
	return { data };
}

function context(latestBuild = build()) {
	const axios = axiosClient.create();
	vi.spyOn(axios, "get");
	vi.spyOn(axios, "post");
	const client = {
		getAxiosInstance: () => axios,
	} as Pick<CoderApi, "getAxiosInstance">;
	const states: Array<DynamicUpdateSession["state"]> = [];
	const session = new DynamicUpdateSession(
		client as CoderApi,
		workspace(latestBuild),
		(state) => states.push(state),
	);
	return {
		axios: { get: vi.mocked(axios.get), post: vi.mocked(axios.post) },
		session,
		states,
	};
}

afterEach(() => vi.useRealTimers());

describe("DynamicUpdateSession", () => {
	it("removes stored ephemeral values after the first evaluation and locks existing immutable values", async () => {
		const { axios, session } = context();
		axios.get.mockResolvedValueOnce(
			response<WorkspaceBuildParameter[]>([
				{ name: "immutable", value: "saved" },
				{ name: "token", value: "old-secret" },
			]),
		);
		axios.post
			.mockResolvedValueOnce(
				response(
					evaluation([
						parameter("immutable", {
							mutable: false,
							value: { valid: true, value: "saved" },
						}),
						parameter("token", {
							ephemeral: true,
							value: { valid: true, value: "old-secret" },
						}),
						parameter("new-immutable", {
							mutable: false,
							value: { valid: true, value: "choose" },
						}),
					]),
				),
			)
			.mockResolvedValueOnce(
				response(
					evaluation([
						parameter("immutable", {
							mutable: false,
							value: { valid: true, value: "saved" },
						}),
						parameter("token", { ephemeral: true }),
						parameter("new-immutable", {
							mutable: false,
							value: { valid: true, value: "choose" },
						}),
					]),
				),
			);

		await session.initialize();

		expect(axios.get).toHaveBeenCalledWith(
			"/api/v2/workspacebuilds/source-build/parameters",
			{ sensitive: true },
		);
		expect(axios.post.mock.calls[0]?.[1]).toMatchObject({
			id: 1,
			owner_id: "owner-id",
			inputs: { immutable: "saved", token: "old-secret" },
		});
		expect(axios.post.mock.calls[1]?.[1]).toMatchObject({
			id: 2,
			inputs: { immutable: "saved" },
		});
		expect(session.state).toMatchObject({
			status: "ready",
			locked: ["immutable"],
			inputs: { immutable: "saved", "new-immutable": "choose" },
			canSubmit: true,
		});
	});

	it("uses local generations because the REST evaluator always responds with id zero", async () => {
		vi.useFakeTimers();
		const { axios, session } = context();
		axios.get.mockResolvedValue(response<WorkspaceBuildParameter[]>([]));
		axios.post.mockResolvedValue(response(evaluation([parameter("region")])));
		await session.initialize();

		let resolveFirst:
			| ((
					value: ReturnType<typeof response<DynamicParametersResponse>>,
			  ) => void)
			| undefined;
		let resolveSecond:
			| ((
					value: ReturnType<typeof response<DynamicParametersResponse>>,
			  ) => void)
			| undefined;
		axios.post
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveSecond = resolve;
					}),
			);

		session.change("region", "first");
		await vi.advanceTimersByTimeAsync(250);
		session.change("region", "second");
		await vi.advanceTimersByTimeAsync(250);
		resolveSecond?.(
			response(
				evaluation([
					parameter("region", { value: { valid: true, value: "second" } }),
				]),
			),
		);
		await Promise.resolve();
		resolveFirst?.(
			response(
				evaluation([
					parameter("region", { value: { valid: true, value: "first" } }),
				]),
			),
		);
		await Promise.resolve();

		expect(session.state.inputs).toEqual({ region: "second" });
		expect(session.state.revision).toBe(2);
	});

	it("cancels evaluation and does not publish after disposal", async () => {
		vi.useFakeTimers();
		const { axios, session, states } = context();
		axios.get.mockResolvedValue(response<WorkspaceBuildParameter[]>([]));
		axios.post.mockResolvedValue(response(evaluation([parameter("region")])));
		await session.initialize();
		axios.post.mockImplementationOnce(
			(_url, _body, config) =>
				new Promise((resolve, reject) => {
					(config as { signal: AbortSignal }).signal.addEventListener(
						"abort",
						() => reject(new Error("aborted")),
					);
					setTimeout(
						() => resolve(response(evaluation([parameter("region")]))),
						1_000,
					);
				}),
		);

		session.change("region", "later");
		await vi.advanceTimersByTimeAsync(250);
		const beforeDispose = states.length;
		session.dispose();
		await vi.advanceTimersByTimeAsync(1_000);

		expect(states).toHaveLength(beforeDispose);
		expect(axios.post.mock.calls.at(-1)?.[2]).toMatchObject({
			sensitive: true,
		});
	});

	it("blocks submit for diagnostics and never creates a build", async () => {
		const { axios, session } = context();
		axios.get.mockResolvedValue(response<WorkspaceBuildParameter[]>([]));
		axios.post.mockResolvedValue(
			response({
				...evaluation([parameter("region")]),
				diagnostics: [
					{ severity: "error", summary: "Invalid", detail: "bad", extra: {} },
				],
			}),
		);
		await session.initialize();

		expect(await session.submit(session.state.revision)).toBe(false);
		expect(axios.post).toHaveBeenCalledTimes(1);
	});

	it("stops only a running source build, starts the pinned target version, and verifies success", async () => {
		vi.useFakeTimers();
		const source = build({ status: "running" });
		const stop = build({
			id: "stop",
			build_number: 2,
			transition: "stop",
			job: { status: "pending" } as WorkspaceBuild["job"],
		});
		const start = build({
			id: "start",
			build_number: 3,
			template_version_id: "target-version",
			job: { status: "pending" } as WorkspaceBuild["job"],
		});
		const { axios, session } = context(source);
		axios.get
			.mockResolvedValueOnce(
				response<WorkspaceBuildParameter[]>([
					{ name: "region", value: "west" },
				]),
			)
			.mockResolvedValueOnce(response(workspace(source)))
			.mockResolvedValueOnce(response([source]))
			.mockResolvedValueOnce(
				response({
					...stop,
					job: { status: "succeeded" } as WorkspaceBuild["job"],
				}),
			)
			.mockResolvedValueOnce(
				response({
					...start,
					job: { status: "succeeded" } as WorkspaceBuild["job"],
				}),
			)
			.mockResolvedValueOnce(
				response(
					workspace({
						...start,
						job: { status: "succeeded" } as WorkspaceBuild["job"],
					}),
				),
			);
		axios.post
			.mockResolvedValueOnce(
				response(
					evaluation([
						parameter("region", { value: { valid: true, value: "west" } }),
					]),
				),
			)
			.mockResolvedValueOnce(response(stop))
			.mockResolvedValueOnce(response(start));
		await session.initialize();

		const submitting = session.submit(session.state.revision);
		await vi.runAllTimersAsync();
		expect(await submitting).toBe(true);
		expect(axios.post.mock.calls.slice(1)).toEqual([
			[
				"/api/v2/workspaces/workspace-id/builds",
				{ transition: "stop" },
				{ sensitive: true },
			],
			[
				"/api/v2/workspaces/workspace-id/builds",
				{
					transition: "start",
					template_version_id: "target-version",
					rich_parameter_values: [{ name: "region", value: "west" }],
					reason: "vscode_connection",
				},
				{ sensitive: true },
			],
		]);
		expect(session.state.status).toBe("success");
	});

	it("rejects a stale revision and concurrent build before creating side effects", async () => {
		const source = build({ status: "stopped" });
		const { axios, session } = context(source);
		axios.get
			.mockResolvedValueOnce(response<WorkspaceBuildParameter[]>([]))
			.mockResolvedValueOnce(
				response(workspace(build({ id: "new-build", status: "running" }))),
			);
		axios.post.mockResolvedValueOnce(
			response(evaluation([parameter("region")])),
		);
		await session.initialize();

		expect(await session.submit(session.state.revision - 1)).toBe(false);
		expect(await session.submit(session.state.revision)).toBe(false);
		expect(session.state).toMatchObject({
			status: "error",
			canSubmit: false,
			error: "The workspace changed. Reopen the update form.",
		});
		expect(axios.post).toHaveBeenCalledTimes(1);
	});
});

describe("dynamic update safety", () => {
	it("invalidates an evaluation immediately when an edit arrives during the debounce window", async () => {
		vi.useFakeTimers();
		const { axios, session } = context();
		axios.get.mockResolvedValue(response<WorkspaceBuildParameter[]>([]));
		axios.post.mockResolvedValue(response(evaluation([parameter("region")])));
		await session.initialize();
		let resolveOld!: (
			result: ReturnType<typeof response<DynamicParametersResponse>>,
		) => void;
		axios.post.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveOld = resolve;
				}),
		);
		session.change("region", "first");
		await vi.advanceTimersByTimeAsync(250);
		session.change("region", "second");
		resolveOld(
			response(
				evaluation([
					parameter("region", { value: { valid: true, value: "first" } }),
				]),
			),
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(session.state.inputs.region).toBe("second");
		expect(session.state.status).toBe("evaluating");
		expect(session.state.canSubmit).toBe(false);
		expect(await session.submit(session.state.revision)).toBe(false);
		session.dispose();
	});

	it("retries loading saved values rather than evaluating empty inputs after initialization fails", async () => {
		const { axios, session } = context();
		axios.get
			.mockRejectedValueOnce(new Error("network"))
			.mockResolvedValueOnce(response([{ name: "region", value: "saved" }]));
		axios.post.mockResolvedValue(response(evaluation([parameter("region")])));
		await session.initialize();
		expect(session.state.canRetry).toBe(true);
		await session.retry();
		expect(axios.get).toHaveBeenCalledTimes(2);
		expect(axios.post.mock.calls[0][1]).toMatchObject({
			inputs: { region: "saved" },
		});
	});

	it("blocks immutable and disabled edits but allows first-use immutable values", async () => {
		const { axios, session } = context();
		axios.get.mockResolvedValue(
			response([{ name: "existing", value: "saved" }]),
		);
		axios.post.mockResolvedValue(
			response(
				evaluation([
					parameter("existing", { mutable: false }),
					parameter("introduced", { mutable: false }),
					parameter("disabled", { styling: { disabled: true } }),
				]),
			),
		);
		await session.initialize();
		session.change("existing", "changed");
		session.change("disabled", "changed");
		expect(session.state.inputs).toMatchObject({
			existing: "saved",
			disabled: "",
		});
		session.change("introduced", "choice");
		expect(session.state.inputs.introduced).toBe("choice");
		session.dispose();
	});

	it("retains fatal prior-state diagnostics even if edited inputs render successfully", async () => {
		vi.useFakeTimers();
		const { axios, session } = context();
		axios.get.mockResolvedValue(response([]));
		axios.post
			.mockResolvedValueOnce(
				response({
					...evaluation([parameter("region")]),
					diagnostics: [
						{
							severity: "error",
							summary: "Incompatible historical values",
							detail: "Contact the template administrator",
							extra: { code: "invalid" },
						},
					],
				}),
			)
			.mockResolvedValueOnce(response(evaluation([parameter("region")])));
		await session.initialize();
		session.change("region", "valid");
		await vi.advanceTimersByTimeAsync(250);
		expect(session.state.canSubmit).toBe(false);
		expect(session.state.diagnostics).toContainEqual(
			expect.objectContaining({ summary: "Incompatible historical values" }),
		);
	});

	it("prevents a monotonic value decrease before stopping the workspace", async () => {
		const { axios, session } = context();
		axios.get.mockResolvedValue(response([{ name: "size", value: "10" }]));
		axios.post.mockResolvedValue(
			response(
				evaluation([
					parameter("size", {
						type: "number",
						value: { valid: true, value: "5" },
						validations: [
							{
								validation_monotonic: "increasing",
								validation_error: "",
								validation_min: null,
								validation_max: null,
								validation_regex: null,
							},
						],
					}),
				]),
			),
		);
		await session.initialize();
		expect(session.state.canSubmit).toBe(false);
		expect(session.state.parameters[0].diagnostics).toContainEqual(
			expect.objectContaining({ extra: { code: "monotonic" } }),
		);
		expect(await session.submit(session.state.revision)).toBe(false);
	});

	it.each(["failed", "canceled"] as const)(
		"does not start a build after the stop job is %s",
		async (status) => {
			const { axios, session } = context();
			axios.get
				.mockResolvedValueOnce(response([]))
				.mockResolvedValueOnce(response(workspace()))
				.mockResolvedValueOnce(response([build()]))
				.mockResolvedValueOnce(
					response(build({ job: { ...build().job, status } })),
				);
			axios.post
				.mockResolvedValueOnce(response(evaluation([])))
				.mockResolvedValueOnce(response(build({ id: "stop" })));
			await session.initialize();
			expect(await session.submit(session.state.revision)).toBe(false);
			expect(axios.post).toHaveBeenCalledTimes(2);
			expect(session.state.canRetry).toBe(false);
			await session.retry();
			expect(axios.post).toHaveBeenCalledTimes(2);
		},
	);

	it("does not start after the form is closed while a stop request is in flight", async () => {
		const { axios, session } = context();
		axios.get
			.mockResolvedValueOnce(response([]))
			.mockResolvedValueOnce(response(workspace()))
			.mockResolvedValueOnce(response([build()]));
		let resolveStop!: (
			result: ReturnType<typeof response<WorkspaceBuild>>,
		) => void;
		axios.post
			.mockResolvedValueOnce(response(evaluation([])))
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveStop = resolve;
					}),
			);
		await session.initialize();
		const submitting = session.submit(session.state.revision);
		await vi.waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
		session.dispose();
		resolveStop(response(build({ id: "stop" })));
		expect(await submitting).toBe(false);
		expect(axios.post).toHaveBeenCalledTimes(2);
		expect(session.state.inputs).toEqual({});
	});

	it("does not automatically retry an ambiguous start request or accept edits afterward", async () => {
		vi.useFakeTimers();
		const source = build({ status: "stopped" });
		const { axios, session } = context(source);
		axios.get
			.mockResolvedValueOnce(response([]))
			.mockResolvedValueOnce(response(workspace(source)))
			.mockResolvedValueOnce(response([source]));
		axios.post
			.mockResolvedValueOnce(response(evaluation([parameter("region")])))
			.mockRejectedValueOnce(new Error("secret server detail"));
		await session.initialize();
		expect(await session.submit(session.state.revision)).toBe(false);
		expect(session.state.error).not.toContain("secret server detail");
		session.change("region", "retry");
		await session.retry();
		await vi.advanceTimersByTimeAsync(500);
		expect(axios.post).toHaveBeenCalledTimes(2);
		expect(session.state.canSubmit).toBe(false);
	});
});
