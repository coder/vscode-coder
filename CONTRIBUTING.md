# Contributing

Start with [Development](#development) to build and run the extension. These
guides cover the rest; they serve humans and coding agents alike, and
[AGENTS.md](AGENTS.md) routes agents to them.

- [Code structure](docs/CODE_STRUCTURE.md): where code lives, module and file
  naming, and test placement.
- [Architecture](docs/ARCHITECTURE.md): how opening a workspace works, SSH
  config management, Windows permissions and connection logging.
- [Testing](docs/TESTING.md): unit, webview, integration and OAuth scope
  tests, and testing the open flow by hand.
- [Tooling](docs/TOOLING.md): linting, formatting, TypeScript, Node.js and
  dependency upgrades.
- [Webviews](packages/AGENTS.md): React, `@repo/ui`, Storybook and the
  [IPC contract](packages/webview-shared/README.md).
- [Telemetry](src/instrumentation/CONVENTIONS.md): how to add events, and the
  [event catalog](src/instrumentation/EVENTS.md).

## Development

> [!IMPORTANT]
> Reasoning about networking gets really wonky trying to develop
> this extension from a coder workspace. We currently recommend cloning the
> repo locally

To view your local changes to the extension within VS Code:

1. Run `pnpm package`. This creates a file named coder-remote-VERSION.vsix in your repo directory.
2. In the "Extensions" tab of VS Code, open the kebab menu and select "Install from VSIX...". You can also run "Extensions: Install from VSIX..." from the command palette. Select the VSIX file created by `pnpm package`.

Alternatively:

1. Run `pnpm watch` in the background.
2. OPTIONAL: Compile the `coder` binary and place it in the equivalent of
   `os.tmpdir() + "/coder"`. If this is missing, it will download the binary
   from the Coder deployment, as it normally would. Reading from `/tmp/coder` is
   only done in development mode.

   On Linux or Mac:

   ```bash
   # Inside https://github.com/coder/coder
   $ go build -o /tmp/coder ./cmd/coder
   ```

3. Press `F5` or navigate to the "Run and Debug" tab of VS Code and click "Run
   Extension".
4. If your change is something users ought to be aware of, add an entry in the
   changelog.

### Webviews

```bash
pnpm watch  # Rebuild extension and webviews on changes
```

Press F5 to launch the Extension Development Host. Use "Developer: Reload
Webviews" to see webview changes.

## Pull requests

- Titles use Conventional Commits (`type(scope): message`); CI checks them
  against the types in `.github/workflows/pr-title-lint.yaml`.
- Open PRs as drafts unless asked otherwise, so the author reviews them
  before requesting reviewers.
- Keep the description short: what changed and why, in one or two
  paragraphs. Use Summary, Problem and Fix sections only when the change
  needs them.
- Link related issues and PRs. Add screenshots for UI changes and numbers
  for performance changes.
- Leave out test plans, "benefits" sections, line-by-line walkthroughs and
  marketing language. Let GitHub wrap the prose instead of hard-wrapping it.

## Reviewing

- Read the full files and related code before commenting, and check
  [AGENTS.md](AGENTS.md) before flagging style.
- Report only issues you're confident are real, state their impact ("crashes
  when X", not "could be better"), and make each one actionable.
- State correctness and security findings as facts, not "might" or "could";
  verify how an API behaves instead of guessing.
- Don't flag style that matches existing patterns, unchanged code,
  theoretical issues without a concrete impact, or changes outside the PR's
  purpose.

## Releasing

For both stable and pre-releases:

1. Check that the changelog lists all the important changes.
2. Update the package.json version and add a version heading to the changelog.

### Stable Release

1. Push a tag `v<version>` (e.g. `v1.15.0`) from the `main` branch. The release
   pipeline will only run for tags on `main`.
2. The pipeline builds, publishes to the VS Code Marketplace and Open VSX, and
   creates a draft GitHub release.
3. Update the draft release with the changelog contents and publish it.

### Pre-Release

1. Push a tag `v<version>-pre` (e.g. `v1.15.0-pre`) from any branch. The version
   in the tag must match package.json (the `-pre` suffix is stripped during
   validation). Pre-release tags are not restricted to `main`.
2. The pipeline builds with `--pre-release`, publishes to both marketplaces, and
   creates a draft pre-release on GitHub.
