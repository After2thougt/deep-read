$path = 'D:\Projects\deep-read\src\pages\ReaderPage.jsx'
$content = Get-Content $path -Raw

# Add import
$old = 'import Reader from "../components/Reader";'
$new = 'import Reader from "../components/Reader";`n`nimport { safeGetItem, safeSetItem } from "../utils/storage";'
$content = $content.Replace($old, $new)

# Replace localStorage.getItem for font-size
$content = $content.Replace('localStorage.getItem(', 'safeGetItem(')
# Replace localStorage.setItem for font-size
$content = $content.Replace('localStorage.setItem(', 'safeSetItem(')
# Replace localStorage.setItem for article-page
$content = $content.Replace('localStorage.setItem(', 'safeSetItem(')

[IO.File]::WriteAllText($path, $content)
Write-Host 'Updated ReaderPage.jsx'