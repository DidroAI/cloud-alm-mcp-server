#!/usr/bin/env bash
# Build the Claude Desktop extension: cloud-alm-mcp-server.mcpb.
#
#   bun run build && scripts/build-mcpb.sh [output.mcpb]
#
# Stages what the server needs (dist/, the manifest, skills/, scopes/ and
# production dependencies) in a temporary folder and packs it with the mcpb
# CLI. Needs dist/ (run `bun run build` first), npm and npx.
set -euo pipefail

MCPB_VERSION="2.1.2" # @anthropic-ai/mcpb, pinned

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/cloud-alm-mcp-server.mcpb}"
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac

[ -f "$root/dist/cli.js" ] || { echo "dist/cli.js is missing: run \`bun run build\` first." >&2; exit 1; }

version="$(node -p 'require(process.argv[1]).version' "$root/package.json")"
manifest="$(node -p 'require(process.argv[1]).version' "$root/manifest.json")"
[ "$version" = "$manifest" ] || { echo "manifest.json is version $manifest, package.json $version." >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp -R "$root/dist" "$root/skills" "$root/scopes" "$stage/"
cp "$root/package.json" "$root/LICENSE" "$root/manifest.json" "$root/PRIVACY.md" "$root/.mcpbignore" "$stage/"

# Production dependencies only; no install scripts run.
(cd "$stage" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock --loglevel=error)

npx -y "@anthropic-ai/mcpb@$MCPB_VERSION" validate "$stage/manifest.json"
rm -f "$out"
npx -y "@anthropic-ai/mcpb@$MCPB_VERSION" pack "$stage" "$out"

# The packed server must load: unpack it and ask for its version (the CLI
# imports every module of the server before it answers).
check="$stage/unpacked"
mkdir "$check"
unzip -q "$out" -d "$check"
packed="$(node "$check/dist/cli.js" --version)"
[ "$packed" = "$version" ] || { echo "The packed server answers version '$packed', not $version." >&2; exit 1; }
echo "Built $out ($version)"
