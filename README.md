# LinkedIn Profile API

A hosted HTTP API that accepts a public LinkedIn profile URL and returns structured JSON —
name, headline, location, about, experience, education, skills, certifications, languages,
and profile/background images — built directly on LinkedIn's internal **Voyager** API rather
than screen-scraping rendered HTML.

## Approach

LinkedIn's own web app (linkedin.com) doesn't render profile pages server-side from HTML
templates. It calls an internal JSON API — referred to internally as **Voyager**
(`https://www.linkedin.com/voyager/api/...`) — from the browser after you're logged in, and
renders the page from the response. That API is undocumented and unversioned, but it's
reachable by anyone who can present a valid authenticated session, because it's the same API
the browser itself uses.

This project logs in as a normal user (you, via your browser) once to obtain a session
cookie, then talks to that Voyager API directly over HTTPS from the backend:

1. **Session cookie, not stored credentials.** The server never handles a LinkedIn
   email/password. You log into linkedin.com in your own browser and copy out the `li_at`
   session cookie (see [Getting a LinkedIn session cookie](#getting-a-linkedin-session-cookie)
   below) into an environment variable. The server presents that cookie on every request,
   exactly like your browser does.
2. **`GET /voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity={id}&decorationId=...`.**
   Given a profile URL like `https://www.linkedin.com/in/jane-doe/`, the server extracts the
   public identifier (`jane-doe`) and calls this Voyager "dash" endpoint, which is the current
   call linkedin.com's own frontend makes to render a profile page. (An older, simpler
   endpoint — `/identity/profiles/{id}/profileView` — is what most public write-ups of this API
   describe, but as of testing it 302-redirects to itself indefinitely; LinkedIn appears to
   have fully retired it in favor of the dash API used here.) It returns nearly everything the
   profile page shows in one response.
3. **Normalized-graph parsing.** Voyager doesn't return a flat object. It returns a small
   root object plus an `included` array containing every entity on the page (the profile
   itself, each position, each degree, each skill, each certification, each language,
   company/school logos, …), each tagged with a fully-qualified type like
   `com.linkedin.voyager.dash.identity.profile.Position` and addressable by its own `entityUrn`.
   [`src/linkedin/urnResolver.ts`](src/linkedin/urnResolver.ts) indexes that array;
   [`src/linkedin/parser.ts`](src/linkedin/parser.ts) walks it **by entity type** (rather than
   by hardcoding the root object's pointer field names, which LinkedIn has changed more often
   than the entity type strings) to assemble the flat response schema below. Images are
   resolved by structurally searching for LinkedIn's `{ rootUrl, artifacts: [...] }`
   "VectorImage" shape and picking the highest-resolution artifact, wherever that shape
   happens to be nested for a given entity.
4. **Everything else is a normal API.** Express handles routing/validation, rate limiting
   protects the LinkedIn session from being flagged, and typed errors map to sensible HTTP
   status codes (see [Errors](#errors)).

See [Known limitations](#known-limitations) for the honest edge of this approach — in
particular, exact Voyager field names can drift over time since it's not a documented,
versioned public API.

## Architecture

```
Client
  │  GET /api/profile?url=https://www.linkedin.com/in/jane-doe/
  ▼
Express app (src/app.ts)
  │  rate limit → optional x-api-key check → route
  ▼
src/routes/profile.ts        validates the "url" query param
  ▼
src/linkedin/index.ts        orchestrates: URL → publicIdentifier → fetch → parse
  │
  ├─ src/utils/urlParser.ts        extracts "jane-doe" from any LinkedIn profile URL shape
  ├─ src/linkedin/client.ts        authenticated HTTPS call to Voyager's dash profile endpoint
  ├─ src/linkedin/urnResolver.ts   indexes the raw response's `included` entity graph
  └─ src/linkedin/parser.ts        walks the graph by entity type → LinkedInProfile JSON
```

## Response schema

```ts
{
  publicIdentifier: string;
  profileUrl: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  connectionsCount: number | null;
  followersCount: number | null;
  experience: Array<{
    title: string | null;
    companyName: string | null;
    companyLogoUrl: string | null;
    location: string | null;
    startDate: { month: number | null; year: number | null } | null;
    endDate: { month: number | null; year: number | null } | null;
    isCurrent: boolean;
    description: string | null;
  }>;
  education: Array<{
    schoolName: string | null;
    schoolLogoUrl: string | null;
    degreeName: string | null;
    fieldOfStudy: string | null;
    startDate: { month: number | null; year: number | null } | null;
    endDate: { month: number | null; year: number | null } | null;
    description: string | null;
  }>;
  skills: Array<{ name: string; endorsementCount: number | null }>;
  certifications: Array<{
    name: string | null;
    authority: string | null;
    licenseNumber: string | null;
    url: string | null;
    startDate: { month: number | null; year: number | null } | null;
    endDate: { month: number | null; year: number | null } | null;
  }>;
  languages: Array<{ name: string; proficiency: string | null }>;
  scrapedAt: string; // ISO 8601 timestamp of when this response was generated
}
```

The full type definitions live in [`src/types/profile.ts`](src/types/profile.ts).

## API documentation

### `GET /api/profile?url=<linkedin-profile-url>`

Returns the [response schema](#response-schema) above for the given profile.

```bash
curl "https://your-deployment.example.com/api/profile?url=https://www.linkedin.com/in/jane-doe/" \
  -H "x-api-key: $API_KEY"   # only required if API_KEY is configured on the server
```

Accepts any of these URL shapes: with/without `https://`, `www.`/`m.`/no subdomain, trailing
slash, query strings (`?trk=...`), and sub-paths (`/in/jane-doe/details/experience/`).

### `GET /api/status`

Confirms the server's configured LinkedIn session is still valid, without spending a full
profile fetch. Useful after deploying to sanity-check `LI_AT_COOKIE` before pointing real
traffic at `/api/profile`.

```bash
curl "https://your-deployment.example.com/api/status" -H "x-api-key: $API_KEY"
# { "linkedinSession": "valid", "memberId": "..." }
```

### `GET /health`

Unauthenticated liveness check (used by Render's health check). Does not touch LinkedIn.

### Errors

All errors are returned as `{ "error": string, "type": string }`.

| Status | `type`                        | Meaning                                                                 |
| ------ | ----------------------------- | ------------------------------------------------------------------------ |
| 400    | `InvalidProfileUrlError`      | `url` is missing or isn't a recognizable LinkedIn profile URL.          |
| 401    | —                             | Missing/incorrect `x-api-key` header (only when `API_KEY` is configured).|
| 404    | `LinkedInProfileNotFoundError`| No such profile, or it's private/restricted from this account's view.  |
| 429    | `LinkedInRateLimitError`      | LinkedIn rate-limited or challenged the request (e.g. a checkpoint).    |
| 502    | `LinkedInAuthError`           | The configured session cookie is missing, invalid, or expired.         |
| 502    | `LinkedInRequestError`        | LinkedIn returned an unexpected error.                                  |
| 500    | `Error`                       | Server misconfiguration or unexpected failure (check server logs).      |

## Getting a LinkedIn session cookie

This server authenticates as **you**, using a session your browser already created — it does
not automate a login flow (so it never has to solve LinkedIn's CAPTCHA/2FA/checkpoint
challenges, which browser-automation-based scrapers constantly run into).

1. Log into [linkedin.com](https://www.linkedin.com) in your browser — **use a secondary
   account, not your primary one**. This is not just general caution: in testing, a session
   got force-logged-out by LinkedIn on its very next use after a single successful request
   (see [Known limitations](#known-limitations)). Assume any account used here will get logged
   out and need re-authenticating, possibly often.
2. Open DevTools → **Application** tab (Chrome/Edge) or **Storage** tab (Firefox) → **Cookies**
   → `https://www.linkedin.com`.
3. Copy the value of the `li_at` cookie into `LI_AT_COOKIE`.
4. Also copy `bcookie`, `bscookie`, and `lidc` into `LI_BCOOKIE`, `LI_BSCOOKIE`, and `LI_LIDC`.
   These aren't optional in practice — they're the difference between the request looking like
   a continuing browser session versus a bare cookie replayed from somewhere else, which is the
   leading suspect for the forced-logout behavior above.
5. Optionally also copy the `JSESSIONID` cookie's value (including the surrounding quotes,
   e.g. `"ajax:1234567890123456789"`) into `LI_JSESSIONID`. If you skip this, the server
   generates and consistently reuses a random one at startup — LinkedIn only checks that the
   `JSESSIONID` cookie and the `csrf-token` header match (a CSRF double-submit check), not
   that it corresponds to a real server-side session, so a self-generated value works.

These cookies are bearer credentials for your LinkedIn session — treat them like a password.
They will eventually expire (LinkedIn sessions typically last on the order of weeks) or get
invalidated by LinkedIn's own security response, at which point `/api/status` will start
returning a `LinkedInAuthError`/`LinkedInRequestError` and you'll need to repeat these steps.
**Test sparingly** — see the cadence warning in [Known limitations](#known-limitations); don't
re-run `/api/profile` "just to check," since each live call appears to spend part of a limited
budget rather than being a free, repeatable action.

## Setup

### Prerequisites

- Node.js 18+
- A LinkedIn session cookie (see above)

### Local development

```bash
npm install
cp .env.example .env
# edit .env: fill in LI_AT_COOKIE at minimum

npm run dev       # starts the API on http://localhost:3000 with hot reload
npm test          # runs the parser/URL-parsing unit test suite
```

### Environment variables

| Variable                | Required | Default       | Description                                                        |
| ------------------------ | -------- | ------------- | -------------------------------------------------------------------- |
| `LI_AT_COOKIE`           | Yes      | —             | Your LinkedIn `li_at` session cookie value.                        |
| `LI_BCOOKIE`             | Strongly recommended | — | Your LinkedIn `bcookie` value, from the same browser session.       |
| `LI_BSCOOKIE`            | Strongly recommended | — | Your LinkedIn `bscookie` value, from the same browser session.      |
| `LI_LIDC`                | Recommended | —          | Your LinkedIn `lidc` value, from the same browser session.          |
| `LI_JSESSIONID`          | No       | auto-generated| Your LinkedIn `JSESSIONID` cookie value (with quotes).              |
| `PORT`                   | No       | `3000`        | Port the server listens on.                                        |
| `API_KEY`                | No       | disabled      | If set, requests must send this value in `x-api-key`.               |
| `CORS_ORIGIN`            | No       | `*`           | Comma-separated allowed origins, or `*` for any.                    |
| `RATE_LIMIT_WINDOW_MS`   | No       | `60000`       | Rate limit window, in milliseconds.                                 |
| `RATE_LIMIT_MAX`         | No       | `20`          | Max requests per window per IP.                                     |
| `NODE_ENV`               | No       | `development` | `production` enables combined-format request logging.               |

### Production build

```bash
npm run build   # compiles src/ -> dist/
npm start        # runs dist/server.js
```

## Deployment (Render)

This repo includes a [`render.yaml`](render.yaml) blueprint.

1. Push this repository to GitHub.
2. In the Render dashboard: **New** → **Blueprint** → select this repo. Render reads
   `render.yaml` and provisions a free web service with the correct build/start commands and
   a `/health` health check.
3. In the service's **Environment** tab, set `LI_AT_COOKIE` (and optionally `LI_JSESSIONID`,
   `API_KEY`) — these are marked `sync: false` in the blueprint specifically so they're never
   committed to the repo and must be entered manually in Render's dashboard.
4. Deploy. Render provisions HTTPS automatically on the `*.onrender.com` domain (or a custom
   domain, if configured).
5. Verify with `curl https://<your-service>.onrender.com/api/status`. If it comes back
   `LinkedInAuthError` immediately on a freshly-extracted cookie, see the datacenter-IP note in
   [Known limitations](#known-limitations) — Render's egress IPs are cloud IPs, which LinkedIn's
   bot detection weighs more heavily than a residential/browser IP.

Any other Node-friendly host (Railway, Fly.io, a plain VM, …) works the same way: `npm run
build && npm start`, with the same environment variables and the same IP caveat.

## Known limitations

- **Undocumented API, no stability guarantee.** Voyager is LinkedIn's internal API, not a
  published product. LinkedIn can change field names, entity shapes, or endpoint paths at any
  time without notice, which would require updating `src/linkedin/client.ts` and/or
  `src/linkedin/parser.ts`. The parser is written defensively (type-based entity matching,
  structural image-shape search, everything optional/nullable) specifically to reduce — but
  not eliminate — breakage from small schema drift.
- **Terms of Service.** Automated access to LinkedIn via Voyager is against LinkedIn's User
  Agreement. This project is built for the scope of this take-home challenge; running it
  against real accounts and profiles at any real volume carries real account-restriction and
  legal risk. Use a secondary account, keep request volume low, and don't use this against
  profiles or at a scale you wouldn't be comfortable defending.
- **Session cookie expiry.** `LI_AT_COOKIE` is a snapshot of a login session, not a
  long-lived API key. It expires (typically after some weeks of inactivity, or on password
  change/logout-everywhere), after which `/api/profile` starts failing with
  `LinkedInAuthError` until the cookie is refreshed manually.
- **Rate limiting and challenges.** LinkedIn actively detects and throttles automated
  traffic. High request volume, an unusual request pattern, or a flagged IP can trigger a
  `429`/challenge response (surfaced here as `LinkedInRateLimitError`) or a checkpoint that
  requires solving a CAPTCHA in an actual browser before the session works again. This service
  applies its own conservative rate limit (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`) as a
  guardrail, not a guarantee.
- **Origin IP matters, confirmed by testing.** Calling the dash endpoint from a datacenter/
  cloud IP (as opposed to a normal residential/browser IP) got a valid session actively
  invalidated by LinkedIn mid-test — the response carried `Set-Cookie` headers deleting
  `li_at`/`li_a`/`liap`, i.e. a server-side forced logout, not just a data error. Deploying
  this service on a normal cloud host (Render included) may run into the same detection;
  if `/api/status` starts failing right after a deploy despite a freshly-extracted cookie,
  this is the likely cause, not a code bug.
- **Field shapes vary between the legacy and "dash" Voyager namespaces.** Some dash entities
  wrap localized strings as `multiLocale<Field>: { en_US: "..." }` instead of a plain string
  field (e.g. `multiLocaleCompanyName` instead of `companyName`), and dates have been observed
  to *not* always use the classic `{ timePeriod: { startDate, endDate } }` wrapper. The parser
  checks several known shapes for both (see `localizedString()` and `timePeriod()` in
  `src/linkedin/parser.ts`); a field still unexpectedly `null` in practice most likely means
  LinkedIn is using a shape not yet accounted for there.
- **Repeated live requests in a short window risk the session, more than volume alone would
  suggest.** During development, a second Voyager request fired shortly after a successful one
  got that session killed the same way described above (forced-logout `Set-Cookie`s) — even
  from the exact same account and process. Treat each live test as spending something, not as
  free/idempotent: verify with one `/api/status` call, then one `/api/profile` call, rather than
  looping or re-running a request "just to check."
- **Visibility depends on the logged-in account.** Some data (full connection lists, exact
  connection/follower counts, some contact info) is only visible depending on your account's
  relationship to the profile (1st/2nd/3rd-degree connection) and LinkedIn subscription tier.
  Fields that aren't visible to the configured account come back `null` rather than causing
  an error.
- **Private or restricted profiles** return `404 LinkedInProfileNotFoundError` — this API
  cannot and does not attempt to bypass a profile's privacy settings.
- **No CAPTCHA/2FA automation.** By design (see [Approach](#approach)), the server never logs
  in on its own, so it also never handles a fresh login challenge. If LinkedIn puts the
  configured account through a checkpoint, that can only be cleared by logging in via a real
  browser and re-extracting a fresh cookie.
- **Single-profile requests only.** There's no bulk/batch endpoint; each request fetches one
  profile. Given the rate-limiting concerns above, that's deliberate rather than a gap to fill.

## Project structure

```
src/
  app.ts                 Express app: middleware, routes
  server.ts               entry point: starts the HTTP listener
  config.ts               environment variable loading
  types/profile.ts        output JSON schema (TypeScript types)
  utils/urlParser.ts       LinkedIn profile URL -> public identifier
  linkedin/
    client.ts              authenticated HTTP client for the Voyager API
    urnResolver.ts          indexes the raw response's entity graph
    parser.ts               entity graph -> LinkedInProfile
    errors.ts               typed domain errors
    index.ts                 orchestrates url -> profile
  middleware/
    apiKeyAuth.ts            optional x-api-key gate
    errorHandler.ts          typed-error -> HTTP status mapping
  routes/
    profile.ts               GET /api/profile
    status.ts                 GET /api/status
tests/
  parser.test.ts            parser unit tests against a fixture Voyager response
  urlParser.test.ts         URL-parsing edge cases
  fixtures/profileView.sample.json
```
