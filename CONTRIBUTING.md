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

Releases take two people: one starts the release, and a member of the `clients`
team other than them approves it. Nobody pushes release tags; only the release
workflow can create them, after the approval.

1. Check that the changelog lists all the important changes.
2. Update the package.json version and add a version heading to the changelog,
   and merge that to `main`.
3. Run the [Release workflow](https://github.com/coder/vscode-coder/actions/workflows/release.yaml) on `main`
   (Actions → Release → Run workflow) with:
   - `version`: `v<version>` (e.g. `v1.19.0`), matching package.json at the
     commit.
   - `commit`: the full SHA of the commit to release. It must be on `main`,
     except for a pre-release, which can come from any branch of this
     repository.
   - `prerelease`: checked for a pre-release (published with `--pre-release`).

   From the command line:

   ```sh
   gh workflow run release.yaml --ref main \
     -f version=v1.19.0 -f commit="$(git rev-parse origin/main)" -f prerelease=false
   ```

4. A member of `clients` other than you approves the `release-approval`
   deployment. The workflow then tags the commit, builds it, publishes to the
   VS Code Marketplace and Open VSX, and creates a draft GitHub release.
5. Update the draft release with the changelog contents and publish it.

Versions only go up, every release (pre-release or stable) gets its own tag
`v<version>` and its own commit, and every release contains the latest release
on `main`. Stable releases come from `main`. A pre-release can come from any
branch of this repository, so its approver also reviews what the branch adds
on top of `main`. The workflow itself always runs on `main`.
