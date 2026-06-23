# Rebuild Tailwind CSS for production (no CDN)
# Run this after adding new Tailwind classes in HTML/JS
# Requires tailwindcss.exe in the project root (download from https://tailwindcss.com/docs/installation if missing)

cd $PSScriptRoot
.\tailwindcss.exe -i ./static/css/input.css -o ./static/css/tailwind.min.css --minify

Write-Host "Tailwind CSS rebuilt to static/css/tailwind.min.css" -ForegroundColor Green
Write-Host "Commit the min.css if it changed." -ForegroundColor Yellow