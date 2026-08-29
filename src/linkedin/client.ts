import axios, { AxiosInstance, AxiosError } from "axios";
import { config } from "../config";
import {
  LinkedInAuthError,
  LinkedInProfileNotFoundError,
  LinkedInRateLimitError,
  LinkedInRequestError,
} from "./errors";

const VOYAGER_BASE_URL = "https://www.linkedin.com/voyager/api";

// A realistic desktop Chrome UA. LinkedIn's bot detection weighs this along with TLS
// fingerprint and request cadence; a stale/unusual UA makes challenges more likely.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface VoyagerEntity {
  entityUrn?: string;
  $type?: string;
  [key: string]: unknown;
}

export interface VoyagerProfileViewResponse {
  included?: VoyagerEntity[];
  [key: string]: unknown;
}

function buildCookieHeader(): string {
  const parts = [`li_at=${config.linkedin.liAt}`, `JSESSIONID="${config.linkedin.jsessionId}"`];
  if (config.linkedin.bcookie) parts.push(`bcookie=${config.linkedin.bcookie}`);
  if (config.linkedin.bscookie) parts.push(`bscookie=${config.linkedin.bscookie}`);
  if (config.linkedin.lidc) parts.push(`lidc=${config.linkedin.lidc}`);
  return parts.join("; ");
}

function buildClient(): AxiosInstance {
  return axios.create({
    baseURL: VOYAGER_BASE_URL,
    timeout: 15_000,
    headers: {
      Cookie: buildCookieHeader(),
      "csrf-token": config.linkedin.jsessionId,
      "User-Agent": USER_AGENT,
      Accept: "application/vnd.linkedin.normalized+json+2.1",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Li-Lang": "en_US",
      "X-Restli-Protocol-Version": "2.0.0",
      // Mirrors what a real linkedin.com tab sends on its own same-origin XHR/fetch calls —
      // absence of these (and of a request-specific Referer, added per-call below) is itself
      // a bot signal a plain HTTP client wouldn't produce by default.
      Origin: "https://www.linkedin.com",
      "X-Requested-With": "XMLHttpRequest",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    },
  });
}

let client: AxiosInstance | null = null;
function getClient(): AxiosInstance {
  if (!client) client = buildClient();
  return client;
}

function translateError(error: unknown, context: { publicIdentifier?: string } = {}): never {
  if (error instanceof AxiosError) {
    const status = error.response?.status ?? null;
    if (status === 401 || status === 403) {
      throw new LinkedInAuthError();
    }
    if (status === 404) {
      throw new LinkedInProfileNotFoundError(context.publicIdentifier ?? "unknown");
    }
    if (status === 429 || status === 999) {
      throw new LinkedInRateLimitError();
    }
    throw new LinkedInRequestError(
      `LinkedIn request failed${status ? ` with status ${status}` : ""}: ${error.message}`,
      status
    );
  }
  throw error;
}

// LinkedIn's older `/identity/profiles/{id}/profileView` endpoint is deprecated — as of
// testing it 302-redirects to itself indefinitely rather than returning data. The current
// endpoint the linkedin.com frontend actually calls is the "dash" API below.
const PROFILE_DECORATION_ID = "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93";

/**
 * Fetches the full profile for a public identifier via LinkedIn's Voyager "dash" API. Like
 * the legacy profileView endpoint it replaces, this returns a normalized graph: a root
 * object plus an `included` array of every entity (Profile, Position, Education, Skill,
 * Certification, Language, ProfilePicture, ...) referenced by `entityUrn`. See `parser.ts`
 * for how this is resolved into our flat response schema.
 */
export async function fetchProfileView(publicIdentifier: string): Promise<VoyagerProfileViewResponse> {
  try {
    const { data } = await getClient().get<VoyagerProfileViewResponse>("/identity/dash/profiles", {
      params: {
        q: "memberIdentity",
        memberIdentity: publicIdentifier,
        decorationId: PROFILE_DECORATION_ID,
      },
      headers: {
        // A browser fetching this endpoint would only ever be doing so from the profile
        // page itself, not from nowhere — a missing Referer here is a break from that.
        Referer: `https://www.linkedin.com/in/${encodeURIComponent(publicIdentifier)}/`,
      },
    });
    return data;
  } catch (error) {
    translateError(error, { publicIdentifier });
  }
}

/**
 * Lightweight authenticated call used by GET /api/status to confirm the configured
 * LI_AT_COOKIE is still valid without spending a full profile fetch.
 */
export async function checkSession(): Promise<{ ok: true; memberId?: string }> {
  try {
    const { data } = await getClient().get<{ plainId?: string }>("/me");
    return { ok: true, memberId: data.plainId };
  } catch (error) {
    translateError(error);
  }
}
