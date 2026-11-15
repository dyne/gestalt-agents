# Ephemeral hosted Windows CI only; product installation needs no administrator.
param([Parameter(Mandatory=$true)][string]$Repository, [Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference = 'Stop'
$localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if (-not $localData) { throw 'Standard-user local application data is unavailable' }
$scratch = Join-Path $localData ('Temp\gestalt-agents-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$env:TMP = $scratch
$env:TEMP = $scratch
$env:TMPDIR = $scratch
$env:HOME = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$tools = Join-Path $localData 'gestalt-ci-tools'
$nodeDirectory = Split-Path -Parent $Node
$env:PATH = $nodeDirectory + ';' + $tools + ';' + $env:SystemRoot + '\System32;' + $env:SystemRoot + '\System32\WindowsPowerShell\v1.0;' + $env:SystemRoot
$npmCli = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
& $Node $npmCli install --global --prefix $tools --ignore-scripts --no-audit --no-fund @openai/codex@latest
if ($LASTEXITCODE -ne 0) { throw 'Standard-user Codex test dependency installation failed' }
Set-Location -LiteralPath $Repository
$env:GESTALT_NATIVE_TEST_EVIDENCE = Join-Path $Repository 'native-evidence'
& $Node --test --test-reporter=tap tests/repository/test-setup-api.mjs tests/repository/test-setup-command-port.mjs tests/repository/test-setup-rpc.mjs tests/repository/test-native-setup.mjs tests/repository/test-native-helpers.mjs tests/native-setup-smoke.mjs tests/native-owned-setup-smoke.mjs
exit $LASTEXITCODE
