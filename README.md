
# vscode-coder

> Work in Progress

<img width="928" alt="Screen Shot 2021-03-07 at 9 34 00 AM" src="https://user-images.githubusercontent.com/7585078/110245353-4cde7980-7f28-11eb-813b-1c8bc07b3e7d.png">

## Known issues

- Context menu action `Show Logs` is blocking, and blocks until a rebuild completes
- UX confusion risk: `Inspect` shows raw `id` fields
- Online/Offline/Creating/Error states do not refresh automatically, only on open and after an action

## Planned work

- Rethink `Open` UX
  - should we link to Remote SSH panel? should
  - should we allow opening directly into project dirs ourselves?

- Authenticate the CLI from VS Code
  - Install the CLI from VS Code
  - Run without the CLI installed

- Manage DevURLs
  - List, Open, Create, Delete, etc.
