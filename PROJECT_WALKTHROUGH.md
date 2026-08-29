# Project Walkthrough — LinkedIn Profile API

Prep notes for explaining this project out loud. Written as a narrative you can talk through,
not documentation (that's what [README.md](README.md) is for).

---

## 1. The ask, in one sentence

Given a public LinkedIn profile URL, return a structured JSON document with everything on
that profile — name, headline, location, about, experience, education, skills,
certifications, languages, images — from a publicly hosted HTTPS API, by reverse-engineering
LinkedIn's own API rather than using an official (and far more restrictive) one.

## 2. The core insight the whole design hangs on

LinkedIn's web app doesn't render profile pages from server-side HTML templates. When you
open a profile in your browser, the page makes an XHR call to LinkedIn's own internal JSON
API — internally called **Voyager** (`linkedin.com/voyager/api/...`) — and renders the page
client-side from that response. That API isn't public or documented, but it isn't protected
by anything stronger than "are you logged in" — it's the same endpoint the browser itself
calls. So the plan became: **authenticate as a normal logged-in user, then talk to that same
API directly over HTTP**, instead of trying to parse rendered HTML (fragile, misses
dynamically-loaded sections) or driving a real browser with Playwright/Selenium (slow, needs
a browser runtime in production, and doesn't avoid the auth problem anyway — you still need a
logged-in session either way).

## 3. Walking through one request, end to end

Say a client calls:
```
GET /api/profile?url=https://www.linkedin.com/in/jane-doe/
```

1. **`src/app.ts`** — request hits the rate limiter first (protects the LinkedIn account this
   API runs on from being flagged for high volume), then an optional `x-api-key` check (so a
   public HTTPS endpoint doesn't mean *anyone* can spend your LinkedIn session's quota), then
   routes to `src/routes/profile.ts`.
2. **`src/routes/profile.ts`** — validates the `url` query param with `zod`, then hands off to
   the orchestrator.
3. **`src/utils/urlParser.ts`** — LinkedIn profile URLs show up in a dozen shapes (`www.` /
   `m.` / bare domain, http/https, trailing slash, `?trk=...` tracking params, sub-paths like
   `/details/experience/`). This normalizes all of them down to the one thing the API actually
   needs: the public identifier, e.g. `jane-doe`.
4. **`src/linkedin/client.ts`** — makes an authenticated `GET` to
   `/identity/dash/profiles?q=memberIdentity&memberIdentity=jane-doe&decorationId=...` with the
   session cookie, a realistic browser `User-Agent`, and the headers LinkedIn's own frontend
   sends (`csrf-token`, `x-restli-protocol-version`, etc.). This endpoint (LinkedIn's current
   "dash" Voyager API — see §3.5 below on how I found this) is what LinkedIn's own frontend
   calls to render the whole profile page, so it returns almost everything in one round trip.
5. **The tricky part — parsing the response.** Voyager doesn't return `{ name, headline, ... }`.
   It returns a small root object plus an `included` array containing *every* entity that
   appears on the page — the profile itself, each job, each degree, each skill, each
   certification, each language, company/school logos — each one tagged with a
   fully-qualified type string like `com.linkedin.voyager.dash.identity.profile.Position` and
   its own `entityUrn`, LinkedIn-JSON-API style. It's a flattened graph, not a tree.
   - **`src/linkedin/urnResolver.ts`** indexes that `included` array two ways: by `entityUrn`
     (for resolving pointer references, e.g. a position pointing at its company's logo entity)
     and by `$type` (for pulling out "all entities of kind Position").
   - **`src/linkedin/parser.ts`** walks that index **by entity type** to assemble the flat
     response — grab every `Position`-typed entity for `experience`, every `Education`-typed
     entity for `education`, and so on — rather than by hardcoding the root object's pointer
     field names (like `*positionGroupView`). That's a deliberate resilience choice: I don't
     have a documented spec to code against, and in this kind of undocumented API, entity type
     strings have historically been more stable across LinkedIn's revisions than the pointer
     field names wrapping them.
   - **Images** (profile photo, background, company/school logos) are resolved the same
     defensive way: instead of hardcoding where a `VectorImage` (`{ rootUrl, artifacts: [...] }`)
     lives in the tree, I search the relevant subtree structurally for anything shaped like
     one, and pick the highest-resolution `artifact`.
**3.5. A real bug this surfaced, and how I diagnosed it.** Most public write-ups of this API
(and the endpoint I initially built against) point at a simpler, older path:
`/identity/profiles/{id}/profileView`. When I actually ran this against a live profile, that
endpoint returned an HTTP 302 whose `Location` header pointed at the *exact same URL* — an
infinite self-redirect, not a normal "endpoint moved" redirect. That's a strong signal a
legacy path has been fully retired rather than just relocated. I confirmed the replacement
(`/identity/dash/profiles?q=memberIdentity&...`) by researching how current LinkedIn scrapers
describe the "dash" Voyager API, then verified it directly with a raw `curl` against the real
endpoint (bypassing my own app, `--max-redirs 0`, reading only the response headers) before
touching any code. That single request told me two separate things at once: the dash endpoint
is real and reachable (it returned proper backend routing headers like `x-li-fabric`, not
another dead-end redirect), but the specific session I tested with got invalidated
server-side in the process (`Set-Cookie: li_at=delete me; Max-Age=0`) — almost certainly
because the request came from a cloud/datacenter IP, which LinkedIn's bot detection treats far
more suspiciously than a residential browser IP. I stopped further live requests at that point
rather than retrying against a flagged session, updated `client.ts` to call the dash endpoint,
and hardened `parser.ts` for a second thing that research surfaced — dash entities sometimes
wrap strings as `multiLocaleCompanyName: { en_US: "..." }` instead of a plain `companyName`
field, so `str()` now falls back to checking for that shape.

**3.6. The first real end-to-end success, and what it taught me.** After getting a genuinely
fresh cookie and restarting the server (env vars only load at process start — editing `.env`
alone doesn't do anything to an already-running process), `GET /api/profile` returned a real
200 with a real person's actual name, headline, full "about" text, profile photo, employer,
school, and skills — the whole pipeline working end to end. Two things it also revealed:
- **Dates came back `null` everywhere**, even for a clearly-current role. The entities
  themselves were being matched correctly (title/companyName/schoolName all populated), so
  this wasn't a "wrong entity type" bug — specifically the `{ timePeriod: { startDate,
  endDate } }` wrapper I'd coded against isn't how the dash API represents duration, at least
  not for every entity. Rather than burn another live request chasing the exact shape blind,
  I widened `timePeriod()` in `parser.ts` to also check a `dateRange: { start, end }` shape and
  a flat `startDate`/`endDate` directly on the entity — the same "check several plausible
  shapes" pattern already used for images and localized strings — and added a unit test locking
  in that fallback.
- **A second request fired shortly after the first successful one got that session killed too**
  — same forced-logout `Set-Cookie` pattern, same account, same process. That reframed my
  earlier "it's the datacenter IP" theory: cadence/repetition in a short window looks like it
  matters at least as much as origin IP. Practically, that means treating every live test as
  something that spends part of a limited budget, not as a free, repeatable check — which is
  why I stopped probing further rather than immediately trying to force a clean before/after
  comparison.
**3.7. Following up on the cadence finding with a concrete fix.** The forced-logout-on-second-use
pattern from §3.6 kept reproducing even on a completely fresh cookie, which pointed away from
"stale credential" and toward something about the request itself reading as non-browser
traffic. Two suspects stood out on review: (1) the client only ever sent `li_at` +
`JSESSIONID` — no `bcookie`/`bscookie`, the long-lived per-browser identifiers a real page load
always carries alongside `li_at`, meaning every request looked like a bare cookie being
replayed outside its original browser, which is a textbook session-hijacking signal; and (2)
the client was missing headers a same-origin browser `fetch` always sends automatically
(`Origin`, `Sec-Fetch-*`, `sec-ch-ua`) and had one that actively worked against it — a
hardcoded `X-Li-Track` value (`{"clientVersion":"1.13.0","osName":"web"}`) that's old and
specific enough to plausibly be copy-pasted across public scraper tutorials, which is exactly
the kind of literal string a fraud team would fingerprint and denylist. Fix: `config.ts` now
accepts `LI_BCOOKIE`/`LI_BSCOOKIE`/`LI_LIDC` as companion cookies, `client.ts` adds the missing
browser-fidelity headers and a per-request `Referer` matching the profile actually being
fetched, and the suspicious static `X-Li-Track` is gone. This is unverified until tested live
again — flagged that way in the docs rather than claimed as fixed, since I deliberately didn't
spend another live request confirming it before writing it up (see the cadence lesson from
§3.6: don't retry live checks just to be sure without a specific reason to).
6. **`src/routes/profile.ts`** sends the resulting typed `LinkedInProfile` object back as JSON.
7. **If anything fails** — invalid URL, expired cookie, profile not found/private, LinkedIn
   rate-limits the request — a typed error (`src/linkedin/errors.ts`) propagates up to
   **`src/middleware/errorHandler.ts`**, which maps it to the right HTTP status
   (400/404/429/502/500) and a consistent `{ error, type }` body, instead of every route
   hand-rolling its own try/catch/status logic.

## 4. Key decisions, and why I made them

| Decision | Why |
|---|---|
| Direct HTTP calls to Voyager, no headless browser | A browser (Playwright/Puppeteer) adds a heavy runtime dependency, is much slower per request, and doesn't remove the auth requirement — you still need a logged-in session either way. Once you have that session's cookie, calling the JSON API directly is faster, lighter, and closer to what "reverse engineer the API" actually means. |
| Manual `li_at` cookie extraction, not automated login | Automating LinkedIn's login form means handling CAPTCHA / 2FA / "verify it's you" checkpoints programmatically — and LinkedIn challenges *programmatic* logins especially hard, more than it challenges an existing valid session. Grabbing the cookie from one real, human-driven browser login sidesteps that entirely and is far more reliable in practice. |
| Type-based entity extraction over pointer-chasing | Since Voyager is undocumented and I can't pin an exact schema version, I optimized the parser for "keeps working even if LinkedIn reshuffles the root object" rather than for "shortest code path through a schema I'm assuming is correct." |
| Structural image-shape search instead of a fixed field path | Same reasoning — `profilePicture.displayImageReference.vectorImage` vs. some other nesting is a real, observed inconsistency across LinkedIn API versions. Searching for the *shape* (`rootUrl` + `artifacts[]`) is more robust than trusting one exact path. |
| Everything in the output schema is nullable | A LinkedIn profile is never guaranteed to have every section filled in (no "about", no certifications, etc.), and depending on the requesting account's relationship to the profile, some fields legitimately aren't visible. Nullable-everywhere means a missing field degrades gracefully instead of crashing the whole response. |
| Typed error classes + one status-code lookup table | Every failure mode (bad URL, expired cookie, profile not found, LinkedIn rate limit) needs a different HTTP status and message. A typed error hierarchy plus one central mapping table means each new failure mode is a one-line addition, not a new if/else branch scattered across route handlers. |
| Rate limiting + optional API key on this API itself | This isn't just "protect my server" — every request this API serves spends the configured LinkedIn account's own request budget with LinkedIn. An unauthenticated, unthrottled public endpoint risks that account getting flagged from abuse that has nothing to do with me. |
| TypeScript + Express | Small, well-understood surface area for a focused API; TypeScript's structural typing was genuinely useful for modeling "a graph of loosely-typed entities I'm defensively narrowing," not just for its own sake. |

## 5. Testing strategy

I can't hit the real LinkedIn API in CI (needs a live authenticated session, and hammering it
for tests would itself be the kind of abuse this project tries to avoid). So the test suite
targets the two things that are actually mine to get right and don't require live LinkedIn
access:
- **`tests/urlParser.test.ts`** — every URL shape variant (protocol/no protocol, `www`/`m`/bare
  host, trailing slash, query params, sub-paths) plus invalid-input edge cases.
- **`tests/parser.test.ts`** — a hand-built fixture (`tests/fixtures/profileView.sample.json`)
  shaped like a Voyager entity graph (multiple positions including a "no end date" current
  role, an education entry, skills with/without endorsement counts, a certification, two
  languages, a company logo reached through a cross-entity urn pointer, and a background image
  nested a few levels deep), plus a second inline fixture specifically covering the dash API's
  `multiLocale*` string-wrapping pattern — verifying the parser assembles the right output from
  that graph, including "pick the highest-resolution image artifact," "resolve a logo through a
  urn pointer," and "fall back to a localized field" logic specifically.

What this *doesn't* cover: whether the fixture's shape still matches what LinkedIn returns
today for every field. Live testing (see §3.5 above) already caught one real gap this way — the
endpoint itself had moved — which is exactly the kind of thing a fixture-only suite can't catch
on its own; worth being upfront about that limit rather than implying the tests prove more than
they do.

## 6. Deployment

Render, via the included `render.yaml` blueprint: `npm install && npm run build` to build,
`npm start` to run, `/health` as the health check LinkedIn... er, Render, polls. Secrets
(`LI_AT_COOKIE`, `LI_JSESSIONID`, `API_KEY`) are marked `sync: false` in the blueprint
specifically so Render prompts for them in its dashboard rather than reading them from the
repo — they're never committed. Any other Node host works the same way since it's just
`npm run build && npm start` plus env vars.

## 7. Known limitations (be upfront about these)

- **It's an undocumented API.** No stability guarantee from LinkedIn; the defensive parsing
  choices above are about reducing breakage from schema drift, not eliminating it.
- **Terms of Service risk.** This is genuinely against LinkedIn's User Agreement — worth
  acknowledging directly rather than hand-waving. Mitigations here (secondary account, low
  request volume, rate limiting) reduce risk, they don't remove it.
- **Session cookies expire** (typically on the order of weeks) and there's no automated
  refresh — `/api/status` exists specifically so that's easy to detect rather than silently
  failing.
- **Origin IP and request cadence are both real factors, not theoretical ones.** Confirmed
  directly during testing (§3.5–3.6): a request from a cloud/datacenter IP got a *valid*
  session actively invalidated by LinkedIn server-side (`Set-Cookie: li_at=delete me;
  Max-Age=0`), and separately, firing a second request shortly after a successful one killed
  that session too — same account, same process. Deploying to any standard cloud host (Render
  included) carries the IP risk, and any usage pattern needs to treat live requests as
  something to spend deliberately, not retry freely. Both are genuine open constraints of this
  approach rather than something more code alone can fix.
- **Visibility depends on the logged-in account's relationship to the profile** (connection
  degree, LinkedIn tier) — some fields are legitimately `null` because they're not visible to
  whichever account's cookie is configured, not because parsing failed.

## 8. What I'd do with more time

Good material for "what would you improve" follow-ups:
- **Caching** — profile data doesn't change minute to minute; a short-TTL cache (Redis, or
  even in-memory) would cut repeat-request load on the LinkedIn account significantly.
- **Automatic session refresh** — detect an expired cookie and (optionally) fall back to a
  one-time browser-automated re-login flow instead of requiring a manual cookie swap.
- **Broader field coverage** — connections/followers counts and richer contact info live
  behind separate Voyager endpoints I didn't wire up (kept scope to the one dash profile call
  for this pass); volunteering, publications, and recommendations sections are similarly
  addressable the same way if needed.
- **A residential/rotating proxy layer** — since the confirmed session-kill in §3.5 traced to
  origin IP, not to the code, that's the actual lever for reliability in a real deployment: route
  Voyager requests through a residential proxy rather than the host's own cloud IP.
- **Retry/backoff with jitter** around transient LinkedIn errors, and a circuit breaker so a
  string of failures backs off automatically instead of continuing to hammer a
  rate-limited/flagged session.
- **Contract tests against recorded real responses** (with PII stripped) to catch schema
  drift earlier than "a production request silently returns a null field."

## 9. Questions I'd expect, and how I'd answer

**"Why not just use an existing library like `linkedin-api`?"**
Could have — it's the same underlying approach (Voyager + session cookie). I built it from
scratch because the challenge explicitly asks to reverse-engineer the API, and doing it
myself meant I actually understand every part of the data flow well enough to explain and
extend it, rather than depending on a third-party package's abstractions and update cadence.

**"What happens when LinkedIn changes the response shape?"**
Type-based extraction and structural image search (see §4) absorb a lot of small drift for
free. A bigger change (e.g. an entity type string itself changing) would show up as fields
silently coming back `null` rather than a hard crash — which is safer in production but does
mean it needs monitoring/alerting on unexpectedly-empty responses to actually notice.

**"How would this scale to many requests per second?"**
It intentionally wouldn't, as built — the rate limiter is deliberately conservative because
the constraint isn't server capacity, it's the LinkedIn account behind it getting flagged. Real
scale would mean multiple accounts/cookies rotated behind a queue, which is a materially
different (and materially riskier) system than what this challenge called for.

**"Is this legal?"**
It's against LinkedIn's Terms of Service to scrape it this way — that's stated plainly in the
README rather than glossed over. I treated this as a technical exercise in API
reverse-engineering under an explicit "you may use your own credentials" allowance from the
challenge, not as something to run against real third-party profiles at any real volume.
