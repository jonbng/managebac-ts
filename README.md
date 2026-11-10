# managebac-js

A small, strongly typed library for reading student-facing ManageBac data. Bun
is used for development, but the published package is standard ESM JavaScript
with generated TypeScript declarations and has no Bun runtime dependency.

This project uses ManageBac's web interface rather than a public API. Pin a
version, handle errors, and expect that upstream markup can eventually change.
Use it only with an account and school domain you are authorized to access.

## Requirements

- Bun 1.3 or newer for development, or Node.js 20.18.1+ as a consumer
- A ManageBac school hostname, username, and password

## Install

```sh
bun add managebac-js
```

## Usage

```js
import { ManageBacClient } from "managebac-js";

const managebac = new ManageBacClient({
  domain: "school.managebac.com",
  username: "student@example.com",
  password: "secret",
});

const homework = await managebac.tasks.listUpcoming();
```

The preferred resource-oriented API is:

```ts
const classes = await managebac.classes.list();
const homework = await managebac.tasks.listUpcoming();

const math = classes[0];
const mathHomework = await managebac.classes
  .byId(math.id)
  .tasks.listUpcoming();

const details = await managebac.classes
  .byId(math.id)
  .tasks.byId(mathHomework[0].id)
  .get();

console.log(details.descriptionText, details.teacher?.name);

const units = await managebac.classes.byId(math.id).units.list();
const events = await managebac.calendar.list({
  start: "2026-09-01",
  end: "2026-10-01",
});

const profile = await managebac.me.get();
const overdue = await managebac.tasks.list({ view: "overdue" });
```

Resource methods log in on first use and reuse the authenticated session.
Calling `login()` explicitly is optional. Returned arrays and records are
immutable. Task views support `upcoming`, `past`, and `overdue`. The original
`homework` resource and `getUpcomingHomework()` method remain as deprecated
compatibility aliases.

By default, login asks ManageBac to remember the session for 30 days. The
library's cookie jar is memory-only, so cookies are never persisted to disk and
do not survive a process restart. Set `rememberMe: false` to request a regular
browser-session cookie instead.

```js
for (const task of homework) {
  console.log(task.id, task.title, task.class.name, task.due.label);
}
```

`task.due.label` preserves the localized value displayed on the task page.
When ManageBac's calendar contains a matching task event, `task.due.at` also
contains its authoritative ISO 8601 timestamp normalized to UTC. It
remains `null` when no matching event exists; the library never guesses a year
or timezone from the label. `task.due.precision` distinguishes exact
date-times from all-day dates.

Full task details include the student-facing submission state and any visible
assessment feedback:

```ts
console.log(details.submission.status);       // "submitted", "not-submitted", ...
console.log(details.submission.statusLabel);  // localized ManageBac label
console.log(details.submission.feedbackText);
```

`submittedAt` remains `null` unless ManageBac exposes an authoritative
submission timestamp. Assignment attachments remain under
`details.attachments`; they are not mislabeled as student-submitted files.

Every item has both ManageBac's source-native `id` and a domain-scoped `key`:

```text
managebac://school.managebac.com/task/9001
```

Use `key` for persistence and synchronization. TypeScript brands task and class
IDs separately, preventing accidental cross-resource ID usage.

For synchronization jobs, use the snapshot API:

```ts
const snapshot = await managebac.tasks.snapshot({ view: "upcoming" });

console.log(snapshot.fetchedAt);
console.log(snapshot.parserVersion);
console.log(snapshot.completeness); // "complete"
console.log(snapshot.items);
```

A snapshot is returned only after every discovered page is fetched and
validated. Identical duplicate records are collapsed; conflicting records with
the same stable key throw `DataIntegrityError` rather than returning ambiguous
data. Unexpected markup also throws instead of being mistaken for an empty
list.

See [the architecture and domain model](docs/architecture.md) for the observed
feature inventory, entity relationships, and expansion rules.

## Configuration

| Option | Default | Purpose |
| --- | --- | --- |
| `domain` | required | School hostname or HTTPS origin |
| `username` | required | ManageBac login |
| `password` | required | ManageBac password |
| `rememberMe` | `true` | Request ManageBac's persistent 30-day session cookie |
| `timeoutMs` | `15000` | Per-request timeout |
| `fetch` | global fetch | Injectable transport for tests |
| `userAgent` | library identifier | Custom HTTP user agent |
| `retry` | two retries | Backoff, maximum delay, and retryable statuses for safe GETs |
| `rateLimit` | 4 concurrent | Concurrency and minimum interval between request starts |
| `cache` | disabled | TTL, bounded in-memory LRU, or an optional shared store |
| `observer` | — | Structured request, retry, parse, and cache events |

Operations also accept `signal` and `cacheMode` (`default`, `reload`, or
`no-store`).

```ts
const client = new ManageBacClient({
  // credentials...
  retry: { maxRetries: 3, baseDelayMs: 250, maxDelayMs: 5_000 },
  rateLimit: { maxConcurrent: 2, minIntervalMs: 100 },
  cache: { ttlMs: 30_000 },
  observer(event) {
    metrics.record(event); // Events never contain credentials or bodies.
  },
});
```

Caching uses an in-memory store by default. A `CacheStore` implementation can
be supplied for a shared cache. Cache failures do not make data retrieval fail,
and `await client.cache.clear()` invalidates keys written by that client.

The observer receives a discriminated `ManageBacEvent` union covering request
starts/completions/errors, retries, parser timings, and cache activity. Observer
failures are isolated and cannot break a scrape.

HTTP domains and cross-origin requests are rejected by default so credentials
cannot accidentally be sent elsewhere.

## Local example

Create `.env` (it is gitignored):

```dotenv
MANAGEBAC_DOMAIN=school.managebac.com
MANAGEBAC_USERNAME=student@example.com
MANAGEBAC_PASSWORD=secret
```

Then run:

```sh
bun run example
```

For an interactive OpenTUI example, run:

```sh
bun run example:tui --demo
```

Omit `--demo` to use the environment variables above and browse the live
`upcoming`, `overdue`, and `past` task views. With no credentials it also falls
back to demo data. All three views and their counts load up front; task details
load automatically as you navigate with `j`/`k`. On narrow terminals, press
`l` or Right Arrow to open details and `h` or Left Arrow to return.

## Errors

All library errors extend `ManageBacError`. Each has a stable `code`, a
`retryable` boolean, its original `cause` when available, and frozen `context`
containing safe diagnostics such as URL, status, request ID, attempt count,
resource, and parser version. Library-generated messages and context never
include passwords, cookies, headers, or response bodies. The original `cause`
is deliberately omitted from JSON serialization and remains under the caller's
control.

```ts
import {
  AuthenticationError,
  RequestAbortedError,
  isManageBacError,
} from "managebac-js";

try {
  await managebac.tasks.listUpcoming();
} catch (error) {
  if (error instanceof RequestAbortedError) return;
  if (error instanceof AuthenticationError) throw new Error("Check credentials");
  if (isManageBacError(error) && error.retryable) scheduleRetry(error);
  throw error;
}
```

| Code | Meaning |
| --- | --- |
| `INVALID_CONFIGURATION` | Invalid client or operation input |
| `AUTHENTICATION_FAILED` | Credentials or the refreshed session were rejected |
| `REQUEST_ABORTED` | The caller's `AbortSignal` stopped the operation |
| `REQUEST_TIMEOUT` | The configured request deadline elapsed |
| `NETWORK_ERROR` | DNS, connection, TLS, or response-stream failure |
| `UNEXPECTED_RESPONSE` | Unexpected HTTP status, redirect, or transport response |
| `PARSER_ERROR` | ManageBac markup or JSON no longer matches the parser |
| `DATA_INTEGRITY_ERROR` | Source records are malformed or conflict |
| `INCOMPLETE_DATA` | A complete collection could not be proven |
| `CACHE_ERROR` | An explicitly requested cache operation failed |

Automatic retries apply only to safe GET requests. `retryable` describes
whether repeating the broader operation may reasonably succeed; it does not
mean the library will retry unsafe requests. Cache reads and writes are
best-effort and emit `cache:error`; an explicit `client.cache.clear()` failure
throws `CacheError` because the requested invalidation did not complete.

## Development

```sh
bun install
bun run typecheck
bun test
bun run build
bun run test:integration
```

The integration test is skipped unless all three `MANAGEBAC_*` variables are
present. It uses the real account only to verify login and the returned schema.
