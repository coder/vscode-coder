New-Item "$HOME\.vscode-server-launcher\bin" -ItemType "directory" -Force
$filePath = "$HOME\.vscode-server-launcher\bin\code-server.exe"
if (!Test-Path($filePath)) {
    Invoke-WebRequest "https://aka.ms/vscode-server-launcher/x86_64-pc-windows-msvc" -OutFile $filePath
}
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$HOME\.vscode-server-launcher\bin", "User")