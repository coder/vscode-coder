# Change Log

## [v0.1.36](https://github.com/coder/vscode-coder/releases/tag/v0.1.36) (2024-04-09)

### Changes

- Automatically update a workspace if required by the template.
- Show more information when remote setup fails.

### Fixes

- Abort remote connection when remote setup fails.

## [v0.1.35](https://github.com/coder/vscode-coder/releases/tag/v0.1.35) (2024-03-12)

### Changes

- Support running within Cursor.

## [v0.1.34](https://github.com/coder/vscode-coder/releases/tag/v0.1.34) (2024-03-03)

### Changes

- Improve fetching the Coder binary. This is mostly just better logging but it
  also will avoid fetching if the existing binary version already matches, to
  support scenarios where the ETag is ignored.

## [v0.1.33](https://github.com/coder/vscode-coder/releases/tag/v0.1.33) (2024-02-20)

### Bug fixes

- Prevent updating template when automatically starting workspace.
