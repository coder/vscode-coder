# Change Log

## [v0.1.34](https://github.com/coder/vscode-coder/releases/tag/v0.1.34) (2024-03-03)

### Changes

- Improve fetching the Coder binary. This is mostly just better logging but it
  also will avoid fetching if the existing binary version already matches, to
  support scenarios where the ETag is ignored.

## [v0.1.33](https://github.com/coder/vscode-coder/releases/tag/v0.1.33) (2024-02-20)

### Bug fixes

- Prevent updating template when automatically starting workspace.
