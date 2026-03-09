# Node Monitor — NestJS service for launching and monitoring native-like jobs

Node Monitor is a lightweight NestJS backend that can launch native (C++)-like processing jobs as child processes, monitor them concurrently, retry intermittent failures, and expose REST APIs for control and analytics. It also generates domain-specific statistical insights about job outcomes to help optimize operational decisions.

- Tech stack: Node.js (>= 18), NestJS 10, TypeScript, pnpm
- Cross‑platform: Works on Windows, macOS, and Linux (auto-detects a native simulator if built, otherwise falls back to a Node child process)

## Features
- Start and monitor multiple jobs concurrently
- Watchdog behavior: detect exits and track success/failure
- Automatic retry (configurable), with a small success boost for high-priority jobs
- In‑memory job state (cleared on app restart)
- REST API:
  - POST `/jobs` — start a new job
  - GET `/jobs` — list all jobs and current status/history
  - GET `/stats` — compute correlations between job characteristics and success
- Rich analytics patterns for the video transcoding domain (see below)
- OpenAPI/Swagger docs at `/docs` with DTO‑based request/response schemas
- ESLint + Prettier setup

## Project structure
```
.
├─ src/
│  ├─ main.ts                   # Nest bootstrap + Swagger setup + global ValidationPipe
│  ├─ app.module.ts             # Root module (ConfigModule + global pipe)
│  ├─ app.controller.ts         # Root hello endpoint
│  ├─ app.service.ts
│  ├─ docs.controller.ts        # Fallback 200 for /docs in test runtime
│  ├─ config/
│  │  └─ app.config.ts          # AppConfig: reads env, provides typed defaults
│  └─ jobs/
│     ├─ jobs.module.ts         # Jobs module
│     ├─ jobs.controller.ts     # REST endpoints + Swagger decorators
│     ├─ jobs.service.ts        # Core logic: run/monitor/retry/stats
│     ├─ job.model.ts           # Internal types and status model
│     └─ dto/
│        ├─ create-job.dto.ts   # Request DTO with validation
│        ├─ job-attempt.dto.ts  # Response DTO for attempt history
│        ├─ job-snapshot.dto.ts # Response DTO for job snapshot
│        └─ stats.dto.ts        # Response DTOs for /stats
├─ native/
│  └─ src/simulator.cpp         # Optional C++ simulator (binary auto-detected if built)
├─ test/                        # E2E tests (supertest)
├─ jest.config.js               # Unit test config
├─ jest-e2e.config.js           # E2E test config
├─ .eslintrc.cjs                # ESLint config
├─ .eslintignore
├─ tsconfig.json                # TS config (dev)
├─ tsconfig.build.json          # TS config (build)
├─ package.json                 # Scripts and deps
└─ pnpm-lock.yaml
```

## Requirements
- Node.js 18 or newer
- pnpm 8 or newer

Check versions:
- Unix/macOS: `node -v && pnpm -v`
- Windows (PowerShell): `node -v; pnpm -v`

If pnpm is missing: `npm i -g pnpm`

## Installation
- Unix/macOS/Linux
  1. `pnpm install`
- Windows (PowerShell or CMD)
  1. `pnpm install`

pnpm may warn about build script approvals on some systems; this project doesn’t require postinstall scripts to run in dev.

## Running the service
The service listens on port 3000 by default; override with `PORT` env.

- Development (watch mode, ts-node-dev)
  - Unix/macOS/Linux:
    ```bash
    pnpm run dev
    # Server: http://localhost:3000
    ```
  - Windows (PowerShell or CMD):
    ```powershell
    pnpm run dev
    # Server: http://localhost:3000
    ```

- Production-like (build + start)
  - Unix/macOS/Linux:
    ```bash
    pnpm run build
    pnpm start
    ```
  - Windows (PowerShell or CMD):
    ```powershell
    pnpm run build
    pnpm start
    ```

- Custom port
  - Unix/macOS/Linux:
    ```bash
    PORT=4000 pnpm run dev
    ```
  - Windows PowerShell:
    ```powershell
    $env:PORT=4000; pnpm run dev
    ```
  - Windows CMD:
    ```bat
    set PORT=4000 && pnpm run dev
    ```

## API
Base URL: `http://localhost:3000`

- POST `/jobs` — start a new job
  - Request body (JSON), as per `CreateJobDto`:
    ```json
    {
      "jobName": "transcode-vid-001",
      "arguments": [
        "codec=h264", "res=1080p", "duration=40", "bitrate=3500", "priority=normal"
      ]
    }
    ```
  - Response: `JobSnapshotDto` — snapshot of the created job (status initially `queued`/`running`)

- GET `/jobs` — list of `JobSnapshotDto`

- GET `/stats` — `StatsResponseDto` (see examples)

### Example requests
- Unix/macOS/Linux (curl):
  ```bash
  curl -X POST http://localhost:3000/jobs \
    -H "Content-Type: application/json" \
    -d '{
      "jobName": "trailer-001",
      "arguments": [
        "codec=h264", "res=1080p", "duration=40", "bitrate=3500", "priority=normal"
      ]
    }'

  curl http://localhost:3000/jobs
  curl http://localhost:3000/stats
  ```

- Windows PowerShell (use single quotes carefully; here-strings are convenient):
  ```powershell
  $body = @'
  {
    "jobName": "feature-uhd-001",
    "arguments": [
      "codec=av1", "res=2160p", "duration=180", "bitrate=12000", "priority=high"
    ]
  }
  '@
  irm http://localhost:3000/jobs -Method Post -ContentType 'application/json' -Body $body
  irm http://localhost:3000/jobs
  irm http://localhost:3000/stats
  ```

## How jobs are simulated
There are two execution backends, with automatic detection:
- Native C++ simulator (preferred if present): `native/bin/simulator` (or `simulator.exe` on Windows). The Nest service will spawn this binary when available.
- Node inline script fallback: if the native binary is not found, the service spawns `node -e` with a tiny script.

Both backends receive job parameters via environment variables (`CODEC`, `RESOLUTION`, `DURATION_SEC`, `BITRATE_K`, `PRIORITY`, `DURATION_MS`), compute success probability **internally** based on these characteristics, sleep for the given duration, and exit with code `0` (success) or `1` (failure) based on randomized outcome.

**The Node service does NOT pre-compute or bias success probability** — it passes raw job parameters to the simulator, which makes its own random decision. This produces **real statistics** reflecting actual job outcomes rather than simulated probabilities.

Success probability computation inside simulators (domain: video transcoding):
- Base probability: 0.82
- Codec adjustments: AV1 -0.18, H.265 -0.08
- Resolution adjustments: UHD -0.12, HD -0.03
- Duration adjustments: >120s -0.1, <30s +0.05
- Priority adjustments: high +0.04
- Clamped to [0.05, 0.98]

Parsed parameters from job `arguments`:
- `codec` (h264 | h265 | av1 | other)
- `res` / `resolution` (mapped to sd | hd | uhd | other)
- `duration` in seconds (or `durationSec`, `dur`)
- `bitrate` (or `bitrateK`, `br`) in kbps
- `priority` (low | normal | high)

On non‑zero exit, the service retries up to `RETRY_MAX_ATTEMPTS` (default 2 total, i.e., one retry); the retry runs shorter with the same job parameters (no artificial probability boost).

### Building the native C++ simulator (optional)
The project includes a tiny C++ program at `native/src/simulator.cpp`. Build it to enable the native backend.

- Windows (PowerShell, requires MSVC Build Tools / Developer Command Prompt with `cl` available):
  ```powershell
  pnpm run build:native:win
  ```
  Output: `native/bin/simulator.exe`

- Unix/macOS (with `clang++` or `g++` in PATH):
  ```bash
  pnpm run build:native:unix
  ```
  Output: `native/bin/simulator`

Auto-detection: when starting attempts, the service looks for `native/bin/simulator(.exe)`. You can also force a path with `NATIVE_SIMULATOR_PATH`.

## Analytics patterns returned by `/stats`
The service analyzes many correlations between job characteristics and success, returning:
```json
{
  "domain": "Video transcoding jobs aimed at improving view-start conversion rates",
  "totalJobs": 42,
  "overallSuccessRate": 0.71,
  "patterns": [
    { "pattern": "Priority = high", "matchCount": 10, "successRate": 0.8, "differenceFromAverage": "+9%", "insight": "..." }
  ]
}
```
Patterns include `pattern`, `matchCount`, `successRate`, `differenceFromAverage`, and a short `insight`.

Implemented patterns (19):
1. Target codec success rates
2. Resolution class success
3. Estimated duration buckets (short/medium/long)
4. Submission window (offpeak/work/peak)
5. Priority tier vs success
6. Bitrate buckets (low/mid/high)
7. Codec × duration interaction
8. Resolution × bitrate mismatch (under/right/over)
9. Submission window × weekend (weekday vs weekend)
10. Cold‑start window (first N minutes) vs warm period
11. Retry effectiveness (overall; fail‑first then success)
12. Failure streaks by codec (rolling windows)
13. PID clustering (process‑level flakiness)
14. Runtime vs planned duration (muchShorter/nearPlanned/muchLonger)
15. Concurrency overlap at submission (low/medium/high)
16. Preset completeness (complete/partial/minimal)
17. Content type via jobName prefix (trailer/feature/shorts/live/other)
18. Priority × submission window interaction
19. Resolution × duration interaction

Notes:
- State is in‑memory; restarting the app clears jobs and analytics history.
- Patterns only report what they can compute from available data; `matchCount` can be 0 if no jobs matched a bucket yet.

## Example responses (abridged)
- POST /jobs (202 Accepted) — `JobSnapshotDto`:
```json
{
  "id": "d3b07384-1a2b-4c5d-9e70-aaaa1111bbbb",
  "jobName": "trailer-001",
  "arguments": ["codec=h264","res=1080p","duration=40","bitrate=3500","priority=normal"],
  "status": "running",
  "attempts": 1,
  "createdAt": 1731000000000,
  "updatedAt": 1731000000100,
  "startedAt": 1731000000100,
  "history": [
    { "attempt": 1, "pid": 12345, "startedAt": 1731000000100 }
  ]
}
```

- GET /jobs — `[JobSnapshotDto]` (one item example):
```json
{
  "id": "d3b07384-1a2b-4c5d-9e70-aaaa1111bbbb",
  "jobName": "trailer-001",
  "arguments": ["codec=h264","res=1080p","duration=40","bitrate=3500","priority=normal"],
  "status": "succeeded",
  "attempts": 1,
  "createdAt": 1731000000000,
  "updatedAt": 1731000001200,
  "startedAt": 1731000000100,
  "finishedAt": 1731000001200,
  "lastExitCode": 0,
  "history": [
    { "attempt": 1, "pid": 12345, "startedAt": 1731000000100, "finishedAt": 1731000001200, "exitCode": 0, "signal": null }
  ]
}
```

- GET /stats — `StatsResponseDto` (abridged):
```json
{
  "domain": "Video transcoding jobs aimed at improving view-start conversion rates",
  "totalJobs": 4,
  "overallSuccessRate": 0.75,
  "patterns": [
    { "pattern": "Target codec = h264", "matchCount": 2, "successRate": 1, "differenceFromAverage": "+25%", "insight": "H.264 remains the most stable path; best for time-sensitive transcodes." },
    { "pattern": "Bitrate bucket = high", "matchCount": 1, "successRate": 0, "differenceFromAverage": "-75%", "insight": "Very high bitrates stress encoders; expect more failures/timeouts." }
  ]
}
```

## Linting & formatting
- Lint: `pnpm run lint`
- Auto-fix: `pnpm run lint:fix`
- Format: `pnpm run format`

## Testing
- Unit tests
  ```bash
  pnpm test
  ```
- E2E tests (boots Nest app in-memory and calls HTTP endpoints)
  ```bash
  pnpm run test:e2e
  ```
- Watch mode
  ```bash
  pnpm run test:watch
  ```

## Windows validation checklist (quick)
1. `pnpm install`
2. `pnpm run dev`
3. `irm http://localhost:3000/` → should say: Hello from NestJS!
4. POST a few jobs (see examples above)
5. `irm http://localhost:3000/jobs` until no `running/retried` remain
6. `irm http://localhost:3000/stats` → patterns populated
7. Open http://localhost:3000/docs → Swagger UI
8. (Optional) Build native sim: `pnpm run build:native:win` and re-run jobs

## Troubleshooting
- Port already in use: change `PORT` env (see below) or free port 3000.
- PowerShell curl alias: prefer `Invoke-RestMethod` (`irm`) or call `curl.exe` explicitly.
- If pnpm warns about build script approvals, you can usually ignore for this project.
- TypeScript strictness: compilation uses `strict: true`. If extending the code, follow existing patterns and types.

## Configuration via environment variables
All are optional; defaults in `src/config/app.config.ts`.
- `PORT`: HTTP port (default 3000)
- `CORS_ORIGIN`: Allowed origin for CORS. Use `*` to allow all; omit to use default permissive CORS
- `RETRY_ENABLED`: Enable retry on failure (`true`/`false`; default `true`)
- `RETRY_MAX_ATTEMPTS`: Total attempts including the initial run (default `2`)
- `COLD_START_MINUTES`: Window length after boot for cold‑start analytics (default `10`)
- `JOB_MIN_MS`: Minimum simulated job duration in ms (default `300`)
- `JOB_MAX_MS`: Maximum simulated job duration in ms (default `8000`)
- `NATIVE_SIMULATOR_PATH`: Absolute path to a compiled native simulator binary to prefer over auto‑detection

Examples
- Unix/macOS/Linux:
```bash
PORT=4000 RETRY_MAX_ATTEMPTS=3 pnpm run dev
```
- Windows PowerShell:
```powershell
$env:PORT=4000; $env:RETRY_MAX_ATTEMPTS=3; pnpm run dev
```

## API documentation (OpenAPI)
- Interactive docs are available at `/docs` once the server is running (example: http://localhost:3000/docs).
- Schemas and examples are driven by DTO classes: `CreateJobDto`, `JobSnapshotDto`, `StatsResponseDto`.

## License
MIT (or project default).