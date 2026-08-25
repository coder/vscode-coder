import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createTestCommands,
	MockConfigurationProvider,
	mockRecentlyOpened,
	openedAuthority,
	useEditor,
} from "../mocks/testHelpers";

const FOLDER = "/workspaces/project";
const CONTAINER = "my-container";

/** The hex payload the extension derives from the arguments below. */
const PAYLOAD = Buffer.from(
	JSON.stringify({
		containerName: CONTAINER,
		hostPath: undefined,
		configFile: undefined,
		localDocker: false,
	}),
	"utf-8",
).toString("hex");

const authorityFor = (editorId: string, payload = PAYLOAD) =>
	`attached-container+${payload}@ssh-remote+coder-${editorId}.dev.coder.com--foo--bar.devcontainer`;

const CURSOR = authorityFor("cursor");
const LEGACY = authorityFor("vscode");

/**
 * Open the devcontainer as the URI handler does, with the given authorities
 * standing in for recently opened folders.
 */
async function openDevContainer(
	recents: string[],
): Promise<string | undefined> {
	new MockConfigurationProvider();
	mockRecentlyOpened(recents, FOLDER);
	const commands = createTestCommands({ baseUrl: "https://dev.coder.com" });
	await commands.openDevContainer(
		"foo",
		"bar",
		"devcontainer",
		CONTAINER,
		FOLDER,
	);
	return openedAuthority();
}

describe("openDevContainer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useEditor("cursor");
	});

	// How the two hosts are chosen between is covered in openWorkspace; these
	// cases are about carrying the container payload across that choice.
	it.each([
		{ label: "its own host with no history", recents: [], expected: CURSOR },
		{ label: "the legacy host it used", recents: [LEGACY], expected: LEGACY },
		{
			label: "the legacy host another devcontainer in the workspace used",
			recents: [authorityFor("vscode", "abcdef")],
			expected: LEGACY,
		},
	])("reopens the devcontainer on $label", async ({ recents, expected }) => {
		expect(await openDevContainer(recents)).toBe(expected);
	});
});
