# Push the local repo to GitHub. Stephen runs this from Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\Users\schur\workspaces\baseball\pastimerivals\tools\push.ps1
$repo = Split-Path -Parent $PSScriptRoot
git -c safe.directory=* -C $repo push -u origin --all
git -c safe.directory=* -C $repo push origin --tags
Write-Host "Done. Check https://github.com/Stephen-Ch/pastimerivals/actions for the test run."
