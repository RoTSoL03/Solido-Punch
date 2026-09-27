param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('dev', 'build')]
  [string]$Command
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio Installer was not found. Install Desktop development with C++.'
}

$vsRoot = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsRoot) {
  throw 'The Visual Studio x64 C++ build tools are not installed.'
}

$devShellModule = Join-Path $vsRoot 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
Import-Module $devShellModule
Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'

$sdkPackageVersion = '10.0.26100.7705'
$sdkVersion = '10.0.26100.0'
$nugetRoot = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path $env:USERPROFILE '.nuget\packages' }
$sdkRoot = Join-Path $nugetRoot "microsoft.windows.sdk.cpp\$sdkPackageVersion\c"
$sdkX64Root = Join-Path $nugetRoot "microsoft.windows.sdk.cpp.x64\$sdkPackageVersion\c"
$kernelLibrary = Join-Path $sdkX64Root 'um\x64\kernel32.lib'

if (-not (Test-Path -LiteralPath $kernelLibrary)) {
  dotnet restore (Join-Path $PSScriptRoot 'windows-sdk\WindowsSdkBootstrap.csproj')
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $kernelLibrary)) {
    throw 'Microsoft Windows SDK C++ packages could not be restored.'
  }
}

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$sdkBin = Join-Path $sdkRoot "bin\$sdkVersion\x64"
$sdkInclude = Join-Path $sdkRoot "Include\$sdkVersion"
$sdkLibraries = @(
  (Join-Path $sdkX64Root 'ucrt\x64'),
  (Join-Path $sdkX64Root 'um\x64')
)
$sdkHeaders = @(
  (Join-Path $sdkInclude 'ucrt'),
  (Join-Path $sdkInclude 'shared'),
  (Join-Path $sdkInclude 'um'),
  (Join-Path $sdkInclude 'winrt'),
  (Join-Path $sdkInclude 'cppwinrt')
)

$env:Path = (@($cargoBin, $sdkBin, $env:Path) -join ';')
$env:LIB = (@($sdkLibraries) + @($env:LIB) -join ';')
$env:INCLUDE = (@($sdkHeaders) + @($env:INCLUDE) -join ';')
$env:WindowsSdkDir = "$sdkRoot\"
$env:WindowsSDKVersion = "$sdkVersion\"

$tauri = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path -LiteralPath $tauri)) {
  throw 'Tauri CLI is not installed. Run npm install first.'
}

Push-Location $projectRoot
try {
  if ($Command -eq 'build') {
    & $tauri build --no-bundle
  } else {
    & $tauri dev
  }
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
