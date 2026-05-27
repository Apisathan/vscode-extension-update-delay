# Extension Update Delay

Extension Update Delay is a Visual Studio Code extension that prevents brand-new extension releases from being installed immediately.

It is useful if you want VS Code extension updates, but prefer to wait until a release has been available for a configurable amount of time, such as 24 or 48 hours.

## How It Works

The extension disables VS Code's built-in automatic extension updates, then performs its own update check.

For each installed extension it:

1. Reads the currently installed version with the VS Code CLI.
2. Queries the Visual Studio Marketplace for the latest published version and release date.
3. Installs the latest version only when that release is older than the configured delay.

Internally it uses:

```powershell
code --list-extensions --show-versions
code --install-extension publisher.name@version --force
```

## Features

- Configurable update delay in hours.
- Optional automatic checks on an interval.
- Manual update check command from the Command Palette.
- Optional disablement of VS Code's built-in extension auto-update setting.
- Extension exclude list for packages you do not want managed.
- Exact-version installs through the VS Code CLI.

## Requirements

- Visual Studio Code
- Node.js, only when developing or packaging the extension
- The VS Code CLI available as `code` or `code.cmd`

On Windows, the default CLI command is `code.cmd`.

## Install From Source

Clone the repository:

```powershell
git clone https://github.com/Apisathan/vscode-extension-update-delay.git
cd vscode-extension-update-delay
```

Install dependencies and compile:

```powershell
npm install
npm run compile
```

Open the project in VS Code:

```powershell
code .
```

Press `F5` to launch an Extension Development Host.

## Package As VSIX

Install the VS Code extension packaging tool:

```powershell
npm install -g @vscode/vsce
```

Build a `.vsix` package:

```powershell
npm run compile
vsce package
```

Install the generated package:

```powershell
code.cmd --install-extension .\extension-update-delay-0.0.1.vsix --force
```

## Usage

Run this command from the Command Palette:

```text
Extension Update Delay: Check Updates Now
```

Logs are written to:

```text
View > Output > Extension Update Delay
```

## Configuration

Example `settings.json`:

```json
{
  "extensionUpdateDelay.delayHours": 48,
  "extensionUpdateDelay.checkIntervalHours": 24,
  "extensionUpdateDelay.autoCheck": true,
  "extensionUpdateDelay.disableBuiltInAutoUpdate": true,
  "extensionUpdateDelay.codeExecutable": "code.cmd",
  "extensionUpdateDelay.excludeExtensions": [
    "publisher.extension-name"
  ]
}
```

Available settings:

- `extensionUpdateDelay.delayHours`: minimum release age before installing an update. Default: `24`.
- `extensionUpdateDelay.checkIntervalHours`: automatic check interval. Default: `24`.
- `extensionUpdateDelay.autoCheck`: enables scheduled update checks. Default: `true`.
- `extensionUpdateDelay.disableBuiltInAutoUpdate`: sets `extensions.autoUpdate` to `false`. Default: `true`.
- `extensionUpdateDelay.codeExecutable`: VS Code CLI command or full path. Default: `code.cmd` on Windows, `code` elsewhere.
- `extensionUpdateDelay.excludeExtensions`: extension IDs to skip.

## Notes

This extension relies on the public Visual Studio Marketplace API and the local VS Code CLI. If your editor uses another marketplace or does not support `code --install-extension publisher.name@version`, exact-version installs may not work.
