# P37-19X / KuShe ERP - Windows read-only TEST LAB Auth preflight
# This script NEVER issues a finance RPC, edits ERP records, stages a test
# case, changes Supabase RLS, or reads real-company credentials.
# Requires Node 20+ and the reviewed repository files on a trusted PC.
[CmdletBinding()]
param([switch]$SelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$LabOrigin = 'https://ldktrfgzzzmklhsnfrol.supabase.co'
$TestCase = '00000000-0000-4000-8000-000000019019'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Operator = Join-Path $Root 'p37-lab\p37-19w\operator-cli.mjs'
$Readiness = Join-Path $Root 'p37-lab\p37-19w\readiness-gate.cjs'
$GateFile = Join-Path $PSScriptRoot 'source-guard.cjs'
$Managed = @(
  'P37_19W_PHASE',
  'P37_19W_PROJECT_CONFIRM',
  'P37_19W_TEST_URL',
  'P37_19W_CASE_ID',
  'P37_19W_TEST_PUBLISHABLE_KEY',
  'P37_19W_TEST_EMAIL',
  'P37_19W_TEST_PASSWORD'
)
$Code = 1
$Bstr = [IntPtr]::Zero
$PlainPassword = $null
$SecurePassword = $null

try {
    if (-not (Test-Path -LiteralPath $Operator -PathType Leaf) -or
        -not (Test-Path -LiteralPath $Readiness -PathType Leaf) -or
        -not (Test-Path -LiteralPath $GateFile -PathType Leaf)) {
        throw 'Missing reviewed P37-19W sources. Use the entire project folder; do not copy the script alone.'
    }

    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $NodeCommand) {
        throw 'Node.js 20 or later is required on this computer.'
    }
    $Version = (& $NodeCommand.Source --version)
    if ($LASTEXITCODE -ne 0) {
        throw 'Node.js --version failed.'
    }
    $NodeVersionMatch = [regex]::Match([string]$Version, '^v([0-9]+)\.')
    if (-not $NodeVersionMatch.Success) {
        throw 'Unable to identify a supported Node.js version.'
    }
    if ([int]$NodeVersionMatch.Groups[1].Value -lt 20) {
        throw 'Node.js 20 or later is required.'
    }

    # Independent source integrity check: W SHA-pins the previously reviewed
    # H/G/V Auth, RPC, stage and exact cleanup code. Fails on source changes.
    & $NodeCommand.Source $GateFile $Readiness $Root
    if ($LASTEXITCODE -ne 0) {
        throw 'Source integrity gate rejected this checkout.'
    }

    if ($SelfTest) {
        Write-Host 'P37-19X SELFTEST_PASS - no network, no login, no account writes.'
        $Code = 0
    } else {
        foreach ($name in $Managed) {
            if ([Environment]::GetEnvironmentVariable($name,'Process')) {
                throw 'Existing P37 test environment variable detected. Use a fresh terminal.'
            }
        }
        foreach ($name in @('SUPABASE_SERVICE_ROLE_KEY',
                            'P37_19W_ADMIN_SECRET',
                            'P37_19W_SERVICE_ROLE',
                            'P37_19W_ALLOW_MAIN',
                            'P37_19W_ALLOW_BETA')) {
            if ([Environment]::GetEnvironmentVariable($name,'Process')) {
                throw 'Administrative or deployment environment variable detected. Use a clean test-only session.'
            }
        }

        Write-Host ''
        Write-Host 'KuShe ERP - P37-19X  TEST LAB SIGNED LOGIN READ-ONLY PREFLIGHT'
        Write-Host 'Target: kushe-auth-lab only. This NEVER posts credits or changes billing.'
        Write-Host 'Enter ONLY a dedicated test-lab email and publishable key.'
        Write-Host 'Do not use your real ERP login or any secret/service-role key.'
        Write-Host ''
        $Confirm = Read-Host 'Type LAB ONLY to proceed (anything else cancels)'
        if ($Confirm -cne 'LAB ONLY') {
            throw 'Operator did not approve isolated test-lab authentication.'
        }

        $Publishable = (Read-Host 'Test lab publishable API key (sb_publishable_...)').Trim()
        if ($Publishable -notmatch '^sb_publishable_[A-Za-z0-9_-]{5,}$') {
            throw 'Not a supported test-lab publishable key.'
        }
        $Email = (Read-Host 'Dedicated TEST LAB email (never a real ERP login)').Trim()
        if ($Email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
            throw 'Invalid dedicated test-lab email format.'
        }
        $SecurePassword = Read-Host 'Dedicated TEST LAB password (hidden)' -AsSecureString
        if ($SecurePassword.Length -eq 0) {
            throw 'No dedicated test-lab password supplied.'
        }

        # Convert only for the child process lifetime. Not CLI arguments,
        # persisted environment, command history, files or logging.
        $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
        $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)

        [Environment]::SetEnvironmentVariable('P37_19W_PROJECT_CONFIRM','KUSHE_AUTH_LAB_ONLY','Process')
        [Environment]::SetEnvironmentVariable('P37_19W_TEST_URL',$LabOrigin,'Process')
        [Environment]::SetEnvironmentVariable('P37_19W_CASE_ID',$TestCase,'Process')
        [Environment]::SetEnvironmentVariable('P37_19W_PHASE','AUTH_ONLY','Process')
        [Environment]::SetEnvironmentVariable('P37_19W_TEST_PUBLISHABLE_KEY',$Publishable,'Process')
        [Environment]::SetEnvironmentVariable('P37_19W_TEST_EMAIL',$Email,'Process')
        [Environment]::SetEnvironmentVariable('P37_19W_TEST_PASSWORD',$PlainPassword,'Process')

        # W -> V -> H: 2 Auth logins, distinct verified session_id claims,
        # /auth/v1/user, RLS membership + ZERO billing cases/allowances;
        # finally logout BOTH Auth sessions. No RPC is ever called.
        & $NodeCommand.Source $Operator
        $Code = $LASTEXITCODE

        if ($Code -eq 0) {
            Write-Host 'P37-19X READ_ONLY_REAL_AUTH_PREFLIGHT_PASS'
            Write-Host 'The RPC race and official ERP posting are STILL NOT approved.'
        } else {
            Write-Host 'P37-19X NO_SIGNED_AUTH_PASS. No finance transaction was submitted.'
            $Code = 1
        }
    }
} catch {
    # Never print exception contents here: nested errors might include paths
    # or credential-derived data. Show only sanitized safety outcomes.
    Write-Host 'P37-19X STOPPED: prerequisite, integrity, or test-only authorization not satisfied.'
    Write-Host 'No finance RPC, staging, cleanup, or ERP posting was attempted.'
    $Code = 1
} finally {
    foreach ($name in $Managed) {
        [Environment]::SetEnvironmentVariable($name,$null,'Process')
    }
    if ($Bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
    }
    $PlainPassword = $null
    $SecurePassword = $null
    $Email = $null
    $Publishable = $null
}
exit $Code
