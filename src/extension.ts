import * as cp from 'node:child_process';
import * as https from 'node:https';
import * as vscode from 'vscode';

type InstalledExtension = {
  id: string;
  version: string;
};

type MarketplaceVersion = {
  version: string;
  lastUpdated: string;
};

type MarketplaceExtension = {
  extensionName: string;
  publisher: {
    publisherName: string;
  };
  versions: MarketplaceVersion[];
};

type MarketplaceResponse = {
  results: Array<{
    extensions: MarketplaceExtension[];
  }>;
};

type CheckResult = {
  installed: InstalledExtension;
  latest?: MarketplaceVersion;
  action: 'updated' | 'current' | 'too-new' | 'excluded' | 'not-found' | 'failed';
  message: string;
};

let timer: NodeJS.Timeout | undefined;
let running = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('extensionUpdateDelay.checkNow', async () => {
      await checkAndInstallEligibleUpdates(true);
    })
  );

  await applyBuiltInAutoUpdateSetting();
  scheduleChecks(context);
}

export function deactivate(): void {
  if (timer) {
    clearTimeout(timer);
  }
}

function scheduleChecks(context: vscode.ExtensionContext): void {
  const config = getConfig();
  if (!config.autoCheck) {
    return;
  }

  const intervalMs = config.checkIntervalHours * 60 * 60 * 1000;
  timer = setTimeout(async () => {
    await checkAndInstallEligibleUpdates(false);
    scheduleChecks(context);
  }, intervalMs);

  context.subscriptions.push({ dispose: () => timer && clearTimeout(timer) });
}

async function applyBuiltInAutoUpdateSetting(): Promise<void> {
  const config = getConfig();
  if (!config.disableBuiltInAutoUpdate) {
    return;
  }

  const extensionsConfig = vscode.workspace.getConfiguration('extensions');
  if (extensionsConfig.get<boolean>('autoUpdate') !== false) {
    await extensionsConfig.update('autoUpdate', false, vscode.ConfigurationTarget.Global);
  }
}

async function checkAndInstallEligibleUpdates(showSummary: boolean): Promise<void> {
  if (running) {
    vscode.window.showInformationMessage('Extension Update Delay is already checking updates.');
    return;
  }

  running = true;
  const output = vscode.window.createOutputChannel('Extension Update Delay');
  output.show(true);
  output.appendLine(`[${new Date().toISOString()}] Checking extension updates`);

  try {
    const config = getConfig();
    const installed = await listInstalledExtensions(config.codeExecutable);
    const exclude = new Set(config.excludeExtensions.map((id) => id.toLowerCase()));
    const results: CheckResult[] = [];

    for (const extension of installed) {
      if (exclude.has(extension.id.toLowerCase())) {
        results.push({
          installed: extension,
          action: 'excluded',
          message: `${extension.id} skipped by configuration.`
        });
        continue;
      }

      const result = await checkOneExtension(extension, config.delayHours, config.codeExecutable);
      results.push(result);
      output.appendLine(result.message);
    }

    const updated = results.filter((result) => result.action === 'updated').length;
    const eligibleButFailed = results.filter((result) => result.action === 'failed').length;
    output.appendLine(`Done. Updated ${updated}; failed ${eligibleButFailed}; checked ${results.length}.`);

    if (showSummary) {
      vscode.window.showInformationMessage(
        `Extension Update Delay: updated ${updated}, failed ${eligibleButFailed}, checked ${results.length}.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Failed: ${message}`);
    vscode.window.showErrorMessage(`Extension Update Delay failed: ${message}`);
  } finally {
    running = false;
  }
}

async function checkOneExtension(
  installed: InstalledExtension,
  delayHours: number,
  codeExecutable: string
): Promise<CheckResult> {
  try {
    const latest = await getLatestMarketplaceVersion(installed.id);
    if (!latest) {
      return {
        installed,
        action: 'not-found',
        message: `${installed.id}: not found in Marketplace.`
      };
    }

    if (latest.version === installed.version) {
      return {
        installed,
        latest,
        action: 'current',
        message: `${installed.id}: already at ${installed.version}.`
      };
    }

    const releaseAgeMs = Date.now() - new Date(latest.lastUpdated).getTime();
    const releaseAgeHours = releaseAgeMs / 60 / 60 / 1000;
    if (releaseAgeHours < delayHours) {
      return {
        installed,
        latest,
        action: 'too-new',
        message: `${installed.id}: ${latest.version} is ${releaseAgeHours.toFixed(1)} hours old; waiting for ${delayHours} hours.`
      };
    }

    await installExtensionVersion(codeExecutable, installed.id, latest.version);
    return {
      installed,
      latest,
      action: 'updated',
      message: `${installed.id}: installed ${latest.version}, released ${latest.lastUpdated}.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      installed,
      action: 'failed',
      message: `${installed.id}: failed: ${message}`
    };
  }
}

function getConfig() {
  const config = vscode.workspace.getConfiguration('extensionUpdateDelay');
  return {
    delayHours: config.get<number>('delayHours', 24),
    checkIntervalHours: config.get<number>('checkIntervalHours', 24),
    autoCheck: config.get<boolean>('autoCheck', true),
    disableBuiltInAutoUpdate: config.get<boolean>('disableBuiltInAutoUpdate', true),
    codeExecutable: config.get<string>('codeExecutable', defaultCodeExecutable()),
    excludeExtensions: config.get<string[]>('excludeExtensions', [])
  };
}

function defaultCodeExecutable(): string {
  return process.platform === 'win32' ? 'code.cmd' : 'code';
}

async function listInstalledExtensions(codeExecutable: string): Promise<InstalledExtension[]> {
  const stdout = await execFile(codeExecutable, ['--list-extensions', '--show-versions']);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.lastIndexOf('@');
      if (separatorIndex <= 0) {
        throw new Error(`Unexpected extension format from code CLI: ${line}`);
      }

      return {
        id: line.slice(0, separatorIndex),
        version: line.slice(separatorIndex + 1)
      };
    });
}

async function getLatestMarketplaceVersion(extensionId: string): Promise<MarketplaceVersion | undefined> {
  const [publisher, extensionName] = splitExtensionId(extensionId);
  const body = JSON.stringify({
    filters: [
      {
        criteria: [
          { filterType: 24, value: extensionName },
          { filterType: 18, value: publisher },
          { filterType: 8, value: 'Microsoft.VisualStudio.Code' }
        ],
        pageNumber: 1,
        pageSize: 1,
        sortBy: 0,
        sortOrder: 0
      }
    ],
    assetTypes: [],
    flags: 0x1
  });

  const response = await postJson<MarketplaceResponse>(
    'marketplace.visualstudio.com',
    '/_apis/public/gallery/extensionquery?api-version=7.2-preview.1',
    body
  );

  const extension = response.results
    .flatMap((result) => result.extensions)
    .find((candidate) => {
      const candidateId = `${candidate.publisher.publisherName}.${candidate.extensionName}`;
      return candidateId.toLowerCase() === extensionId.toLowerCase();
    });

  return extension?.versions?.[0];
}

function splitExtensionId(extensionId: string): [string, string] {
  const separatorIndex = extensionId.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === extensionId.length - 1) {
    throw new Error(`Expected extension ID to look like publisher.name, got ${extensionId}`);
  }

  return [extensionId.slice(0, separatorIndex), extensionId.slice(separatorIndex + 1)];
}

async function installExtensionVersion(codeExecutable: string, extensionId: string, version: string): Promise<void> {
  await execFile(codeExecutable, ['--install-extension', `${extensionId}@${version}`, '--force']);
}

function execFile(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, { windowsHide: true, shell: process.platform === 'win32' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      resolve(stdout);
    });
  });
}

function postJson<T>(host: string, path: string, body: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: 'POST',
        host,
        path,
        headers: {
          Accept: 'application/json;api-version=7.2-preview.1',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'extension-update-delay'
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Marketplace returned ${response.statusCode}: ${text}`));
            return;
          }

          try {
            resolve(JSON.parse(text) as T);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}
