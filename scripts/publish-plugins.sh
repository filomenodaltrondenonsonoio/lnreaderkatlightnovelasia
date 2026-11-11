#!/bin/bash
# Compiles the plugins, builds the manifest and force-pushes the result to the
# orphan branch plugins/v<package.json version>. LNReader reads the manifest
# from:
#   https://raw.githubusercontent.com/<user>/<repo>/plugins/v<version>/.dist/plugins.min.json
set -euo pipefail

version=$(node -p "require('./package.json').version")
dist="plugins/v$version"
current=$(git rev-parse --abbrev-ref HEAD)

echo "Publishing plugins: $current -> $dist"

rm -rf .js .dist
npx tsc --project tsconfig.production.json
BRANCH="$dist" node ./scripts/build-plugin-manifest.js

if [ ! -s .dist/plugins.min.json ] || [ "$(cat .dist/plugins.min.json)" = "[]" ]; then
  echo "ERROR: manifest generation failed" >&2
  exit 1
fi

# LNReader downloads plugin code from the legacy .js/src/plugins path.
mkdir -p .js/src
cp -r .js/plugins .js/src/plugins

git checkout --orphan publish-tmp
git reset
git add -f public/static .dist .js/src/plugins
git commit -m "chore: publish plugins"
git push -f origin "HEAD:refs/heads/$dist"

if [ "$current" != "HEAD" ]; then
  git checkout -f "$current"
fi
echo "Published to $dist"
