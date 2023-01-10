# Contributing

## Architecture

Workspaces opened with Coder Remote have the following URI structure:

```text
vscode://ssh-remote+coder-vscode--<username>--<workspace>/
```

The `ssh-remote` scheme is used by the [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) extension from Microsoft that connects to remote machines.

Coder uses the `onResolveRemoteAuthority:ssh-remote` [extension activation event](https://code.visualstudio.com/api/references/activation-events) to activate the workspace when this scheme is used. On activation, we check if `vscode.workspace.workspaceFolders` contains the `coder-vscode--` prefix, and if so we delay activation to:

1. Match the workspace owner and name from the URI scheme and validate it's accessible.
2. Download the matching server binary to the client.
3. Add an entry to the users SSH config for VS Code Remote to resolve `coder-vscode--*`.

```text
Host coder-vscode--*
	ProxyCommand "/tmp/coder" vscodessh --network-info-dir "/home/kyle/.config/Code/User/globalStorage/coder.coder-remote/net" --session-token-file "/home/kyle/.config/Code/User/globalStorage/coder.coder-remote/session_token" --url-file "/home/kyle/.config/Code/User/globalStorage/coder.coder-remote/url" %h
	ConnectTimeout 0
	StrictHostKeyChecking no
	UserKnownHostsFile /dev/null
	LogLevel ERROR
```

VS Code SSH uses the `ssh -D <port>` flag to start a SOCKS server on the specified port. This port is printed to the `Remote - SSH` log file in the VS Code Output panel in the format `-> socksPort <port> ->`. We use this port to find the SSH process ID that is being used by the remote session.

The `vscodessh` subcommand on the `coder` binary periodically flushes it's network information to `network-info-dir + "/" + process.ppid`. SSH executes `ProxyCommand`, which means the `process.ppid` will always be the matching SSH command.

Coder Remote periodically reads the `network-info-dir + "/" + matchingSSHPID` file to display network information.

## Development

1. Run `yarn watch` in the background.
2. Compile the `coder` binary and place it in the equivalent of `os.tmpdir() + "/coder"`.

   On Linux or Mac:

   ```bash
   # Inside https://github.com/coder/coder
   $ go build -o /tmp/coder ./cmd/coder
   ```

3. Press `F5` or navigate to the "Run and Debug" tab of VS Code and click "Run Extension".
