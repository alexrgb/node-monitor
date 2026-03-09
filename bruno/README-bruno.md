# Bruno workspace for Node Monitor (v1 format)

This folder contains a Bruno collection (version 1) to manually exercise the API, seed jobs, and inspect analytics.

## Contents
- `bruno.json` — collection metadata (`"version": "1"`)
- `environments/`
  - `local.bru` — Local environment with baseUrl=http://localhost:3000
  - `example-remote.bru` — Template for a remote environment
- `Root/`, `Jobs/`, `Stats/` — Request groups with v1 syntax:
  - `meta { name, type, seq }`
  - Method blocks: `get {}`, `post {}`
  - `headers {}`, `body:json {}`
  - `assert {}` for status checks
  - `script:post-response {}` for validation logic

## Quick start
1) Install and run the server (in another terminal):
   - Unix/macOS/Linux: `pnpm run dev`
   - Windows PowerShell/CMD: `pnpm run dev`
2) Option A: Use Bruno Desktop to open this folder (`bruno/`) and run requests under the `Local` environment.
3) Option B: Use Bruno CLI:
   - Run the collection against local env: `pnpm bru:run`
   - CI mode (fail fast): `pnpm bru:run:ci`

## Notes
- This collection uses v1 format for maximum compatibility with all Bruno Desktop versions.
- Requests include validation scripts that check response structure without being flaky.
- You can tweak environment variables (like `baseUrl`) in the `.bru` environment files.
- If you have an older Bruno Desktop that doesn't recognize the format, ensure you're using Bruno v0.13.0 or newer.
