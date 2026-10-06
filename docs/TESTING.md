# Testing

Where test files go is covered in
[CODE_STRUCTURE.md](CODE_STRUCTURE.md#tests). Webview-specific guidance lives
in [packages/AGENTS.md](../packages/AGENTS.md#tests).

## Principles

- Test observable behavior and outputs, not implementation details.
- Descriptive names, minimal setup, no shared mutable state.
- Never mock in end-to-end tests; minimize mocking in unit tests.
- Find root causes, not symptoms: read error messages carefully.
- Cover the failure paths, not only the happy path.
- Never wait on real time to fix a timing problem. Instead of sleeping with
  `setTimeout`, use `vi.useFakeTimers()` and advance the clock, or await the
  event or promise that signals the condition. Sleeps flake under load.
- Extend existing coverage instead of adding a test that duplicates it.
- When adding tests for existing behavior, read the existing tests first and
  add cases for what is not covered. Edit existing tests as needed, but don't
  change what they verify.
- When mocking constructors (classes) with
  `vi.mocked(...).mockImplementation()`, use regular functions, not arrow
  functions. Arrow functions can't be called with `new`.

```typescript
// Wrong
vi.mocked(SomeClass).mockImplementation(() => mock);
// Correct
vi.mocked(SomeClass).mockImplementation(function () {
	return mock;
});
```

## Unit Tests

The project uses Vitest with separate projects for extension and webview code.
Both run inside Electron's Node.js, matching the runtime VS Code ships:

```bash
pnpm test:extension  # Extension tests
pnpm test:webview    # Webview tests (jsdom)
pnpm test            # Both (CI mode)
pnpm test:extension ./test/unit/filename.test.ts  # A single file
```

Test files are named `*.test.ts` and organized by type:

```text
test/
├── unit/           # Extension unit tests (mirrors src/)
├── webview/        # Webview unit tests (mirrors packages/<pkg>/src/, jsdom)
├── integration/    # Integration tests (real VS Code, Mocha)
├── scopes/         # OAuth scopes against a live server
├── utils/          # Test utilities that are also tested
└── mocks/          # Shared test mocks
```

## Integration Tests

Integration tests run inside a real VS Code instance, against both the minimum
supported version and stable (see `test/integration/.vscode-test.mjs`):

```bash
pnpm test:integration
```

They need a display. On headless environments (CI, devcontainers) prefix the
command with `xvfb-run -a`.

- Tests use Mocha (VS Code test runner requirement), not Vitest.
- Test files in `test/integration/` are compiled to `out/` before running.
- The first run downloads each VS Code version into `.vscode-test/`. Tests
  run in that copy with its own user data directory, so an open VS Code
  doesn't interfere.

## OAuth Scope Tests

`test/scopes/` signs in through the extension's OAuth flow against a live
server and runs the probes in `test/scopes/probes.ts` with the token. It needs
Docker and a fresh deployment, since it creates users and workspaces, and
`pnpm test` leaves it out:

```bash
docker compose -f test/scopes/compose.yaml up -d --wait
CODER_SCOPES_TEST_URL=http://localhost:7080 pnpm test:scopes
docker compose -f test/scopes/compose.yaml down -v  # before the next run
```

Pull requests run against the coder-preview image pinned in `compose.yaml`;
the nightly run uses `latest`. Set `CODER_IMAGE` to test another image.

## Testing the open flow by hand

There are a few ways you can test the "Open in VS Code" flow:

- Use the "VS Code Desktop" button from a Coder dashboard.
- Manually open the link with `Developer: Open URL` from inside VS Code.
- Use `code --open-url` on the command line.

The link format is `vscode://coder.coder-remote/open?${query}`. For example:

```bash
code --open-url 'vscode://coder.coder-remote/open?url=dev.coder.com&owner=my-username&workspace=my-ws&agent=my-agent'
```
