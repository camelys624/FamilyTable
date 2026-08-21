# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WeChat Mini Program ("家常" / 家庭菜单) plus a CloudBase (微信云开发) backend. Families share a weekly menu: recipes → week plan → voting → shopping list. All user-facing text is Chinese.

`docs/` holds the authoritative specs, and they are detailed enough to answer most design questions:

- `docs/后端服务与数据库实施计划.md` — the binding backend baseline. Collections and indexes (§5), cloud-function action contracts and error codes (§6), DTO ↔ page-model mapping (§7), permissions/concurrency/transactions (§8), phased migration (§9), task breakdown with IDs (§10), test plan (§11). Its §1 states it **overrides** the tech doc wherever the two disagree on backend scope.
- `docs/家庭菜单微信小程序技术文档.md` — product scope, roles, page behaviour, release/ops.
- `cloudbase/README.md` — first-time CloudBase environment setup order.

Both docs predate the current code in places: the tech doc's page routes (`/pages/family/onboard`, `/pages/menu/week`, …) and the backend doc's suggested directory layout (§2.3, `repositories/contracts.ts`) were not what got built. `miniprogram/app.json` and the actual tree win.

## Commands

There is no root `package.json` and no npm scripts. Everything is run directly.

```bash
# Tests (node:test, zero dependencies)
node --test tests/cloudfunctions/session-handlers.test.js   # a single file
node --test tests/**/*.test.js                              # all
# NOTE: `node --test tests/` fails with MODULE_NOT_FOUND — pass files or a glob.
```

`tests/cloudfunctions/` drives cloud-function handlers against fake repositories. `tests/miniprogram/` drives **the compiled page `.js`** under stubbed `wx` / `Page` globals — the only seam that can catch cross-page bugs such as two navigation guards disagreeing. Because it loads the `.js`, it tests what actually ships; a `.ts` edit without a recompile will not be covered.

```bash
# Config guards (run before any release/env switch)
node scripts/cloudbase/verify-runtime-config.js   # env profiles + runtime safety checks still present
node scripts/cloudbase/verify-index-spec.js       # index manifest is well-formed

# Cloud function dependencies (wx-server-sdk), per function
cd cloudfunctions/auth && npm install
```

Building/running the mini program requires **WeChat DevTools** — open the repo root as the project (`miniprogramRoot: miniprogram/`, `cloudfunctionRoot: cloudfunctions/`). It also compiles the TypeScript (`useCompilerPlugins: ["typescript"]`) and deploys cloud functions ("上传并部署：云端安装依赖"). TypeScript is not installed in-repo, so there is no standalone `tsc` check.

## The .ts / .js duality

Every `miniprogram/**/*.ts` has a committed sibling `.js` that is its compiled CommonJS output — there is no `.gitignore`, and the mini program runtime loads the `.js`. **Editing a `.ts` without regenerating the matching `.js` leaves the running app on the old code.** Change both in the same commit; `git status` in this repo normally shows them modified in pairs.

Outside WeChat DevTools, regenerate with a pinned TypeScript 5.x (the repo `tsconfig.json` says `module: ESNext`, but the committed output is CommonJS, so both must be overridden):

```bash
npx -p typescript@5.9 tsc -p tsconfig.json --module commonjs --moduleResolution node \
  --rootDir miniprogram --outDir /tmp/out
```

That reproduces the committed output byte-for-byte except for the import binding name of `modules/session/index` — the repo has `session_1`, tsc 5.9 emits `index_1`. Rename it back so the next DevTools build doesn't churn the diff, and copy over only the files you actually changed.

`cloudfunctions/` is hand-written CommonJS JavaScript, not TypeScript.

## Architecture

### Two data paths — migration in progress

The app is mid-migration from a local-storage demo to CloudBase, following docs §9.3 phases A–D. **Only phase A (auth + family) is on the cloud path today.**

- `miniprogram/services/store.ts` — the entire app state as one `wx.setStorageSync('family-menu-state-v1')` blob, plus seed recipes. Every tab page (home, menu, recipes, vote, shopping, profile) still calls it directly.
- `miniprogram/modules/session/` — the one migrated slice, and the template for the rest: a `SessionModule` interface, a `LocalSessionAdapter` (wraps `store.ts`) and a `CloudSessionAdapter` (calls cloud functions), with `index.ts` choosing between them from `runtimeConfig.repositoryMode` at import time. Only `app.ts` and `pages/onboarding` consume it.

When migrating a slice, reuse that shape: interface + local adapter + cloud adapter + factory keyed on `repositoryMode`. Per docs §7.6, a failed cloud call must never silently fall back to local/seed data, and production builds are cloud-only.

**One source of truth per slice.** `modules/session/index.ts` owns the cached session snapshot (`ensureSession()` de-dupes the in-flight bootstrap, `getSession()` reads the cache, `completeOnboarding()` refreshes it). Every page guard must ask it — never `getState().onboarded`. In cloud mode the local blob is stale demo data, so a page that judges login state from it will disagree with a page that asks the session, and the two will bounce off each other forever. `tests/miniprogram/startup-navigation.test.js` locks this down. Slices migrated later inherit the same hazard: while a slice is half-migrated, exactly one of local/cloud must be authoritative for it.

### Runtime config gating

`config/environments.ts` defines the dev/test/prod profiles (`stage`, `repositoryMode`, `cloudEnvId`, `apiVersion`) and exports `activeStage` — the single switch deciding local vs cloud. It currently points at `test` with a live `cloudEnvId`, so the app boots against CloudBase.

`config/runtime.ts` `initializeCloudRuntime()` runs in `App.onLaunch` and hard-fails on prod-with-local-repository, a missing or `__`-prefixed placeholder env id, `touristappid`, or a base library without `wx.cloud`. `verify-runtime-config.js` greps the `.ts` source for those guard expressions, so keep them written literally (e.g. `appId === 'touristappid'`).

Only non-sensitive config belongs here — AppSecret, service-account credentials and DB admin keys never enter the mini program bundle.

### Cloud function shape

One function per domain, routed internally by `action`. Seven are planned (`auth family recipe menu vote shopping preference`); `auth` and `family` exist. Three files each, and the split is load-bearing:

- `index.js` — thin adapter: `cloud.init`, identity from `cloud.getWXContext().OPENID`, delegate. The only entry-level `wx-server-sdk` contact.
- `handler.js` — pure factory `createXHandler(repository, logger)` returning `(event, identity)`. Identity check → action routing → payload whitelist/validation → repository call → uniform response. Fully testable against a fake repository, which is what `tests/` does.
- `repository.js` — CloudBase database access, transactions, idempotency.

Wire protocol (docs §6.2), enforced on both ends:

- Request `{ action, payload, requestId }`; response `{ ok: true, data, requestId }` or `{ ok: false, error: { code, message, details }, requestId }`.
- **Identity is never read from the payload.** `assertPayloadFields` rejects unknown keys, so a forged `openid` in `payload` becomes `VALIDATION_ERROR` (covered by a test).
- Write actions require a `requestId` of at least 8 characters.
- Only codes in a function's `SAFE_ERROR_CODES` set reach the client; everything else is logged and flattened to `INTERNAL_ERROR` with a generic message. A new code must be added both to that set and to `AppErrorCode` in `miniprogram/utils/app-error.ts`.

Client side: `repositories/cloud-client.ts` mints the `requestId`, unwraps `ok`/`data`, and normalises failures into `AppError`. `utils/app-error.ts` `toAppError()` pattern-matches raw CloudBase failure strings into `CLOUD_ENV_NOT_FOUND` / `CLOUD_FUNCTION_NOT_FOUND` / `DATABASE_NOT_INITIALIZED` / `NETWORK_ERROR`, so setup mistakes surface as an actionable Chinese message rather than an SDK string.

### Idempotency and transactions

`cloudfunctions/family/repository.js` `create()` is the reference implementation for every future write. Inside one `db.runTransaction`: look up `idempotency_records` by an id derived from `userId + action + requestId`; a same-requestId replay with a different `requestHash` is `IDEMPOTENCY_CONFLICT`, a `succeeded` record replays its `responseSnapshot`, an in-flight one is `REQUEST_IN_PROGRESS`. `stableValue()` sorts object keys before hashing so key order can't change the hash. Deterministic document ids (e.g. membership `fm_<hash(userId)>`) are what make the "already in a family" check race-safe. An `operation_logs` row is written in the same transaction.

Docs §8.5 lists the other operations that must be transactional, and §8.3/§8.4 specify the optimistic-lock (`expectedVersion` → `VERSION_CONFLICT`) and vote-uniqueness patterns the unbuilt slices owe.

### Database

`cloudbase/indexes.json` is the versioned declaration of all 11 collections and their indexes and is the source of truth — anything created in the console or via CLI must match its names, uniqueness flags and field order. Collections are configured client-unreadable/unwritable; only cloud functions touch them. Field-level schemas live in docs §5.

## Conventions

- No semicolons, single quotes, 2-space indent, in both the mini program TypeScript and the cloud function JavaScript. Cloud functions are `'use strict'` CommonJS.
- Error `message` strings are rendered straight into the UI, so they must be safe, Chinese and actionable; stack traces and database text go to `logger.error` only, keyed by `requestId`.
- The server owns identity, `familyId`, timestamps and audit fields; client-supplied values for them are rejected, not merged (docs §1.3, §8.2).
- Family-scoped queries always re-verify an `active` `family_members` row — membership is never cached from login.
- Deletes are soft (`deletedAt`); cross-family resource ids return `NOT_FOUND`, never a "forbidden" that leaks existence.
