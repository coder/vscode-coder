

# vscode-coder

> Work in Progress

<img width="1081" alt="Screen Shot 2021-03-08 at 12 01 25 PM" src="https://user-images.githubusercontent.com/7585078/110361753-0cedc400-8006-11eb-826f-214bfb3dfc6c.png">

## Known issues

- Context menu action `Show Logs` is blocking, and blocks until a rebuild completes
- UX confusion risk: `Inspect` shows raw `id` fields
- Online/Offline/Creating/Error states do not refresh automatically, only on open and after an action
- Commands appear in Command Pallet when they shouldn't

## Planned work

- Rethink `Open` UX
  - should we link to Remote SSH panel?
  - should we allow opening directly into project dirs ourselves?

- Authenticate the CLI from VS Code
  - Install the CLI from VS Code
  - Run without the CLI installed

- Manage DevURLs
  - List, Open, Create, Delete, etc.
