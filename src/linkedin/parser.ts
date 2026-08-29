import { UrnResolver } from "./urnResolver";
import { VoyagerEntity, VoyagerProfileViewResponse } from "./client";
import { LinkedInProfileNotFoundError } from "./errors";
import {
  LinkedInProfile,
  ExperienceEntry,
  EducationEntry,
  SkillEntry,
  CertificationEntry,
  LanguageEntry,
  DatePoint,
} from "../types/profile";

// LinkedIn's Voyager entities are tagged with fully-qualified $type strings like
// "com.linkedin.voyager.identity.profile.Position" (legacy) or
// "com.linkedin.voyager.dash.identity.profile.Position" (current "dash" API). We match by
// suffix rather than walking the root object's pointer fields (e.g. "*positionGroupView")
// because the pointer field names have historically moved between API revisions more often
// than the trailing entity type name has — this also means the same suffixes match both the
// legacy and dash namespaces without any special-casing.
const TYPE = {
  profile: ".profile.Profile",
  position: ".profile.Position",
  education: ".profile.Education",
  skill: ".profile.Skill",
  certification: ".profile.Certification",
  language: ".profile.Language",
};

/**
 * LinkedIn's newer "dash" API entities often wrap localized strings instead of exposing
 * them as a plain field, e.g. `companyName` becomes `multiLocaleCompanyName: { en_US: "..." }`.
 * This checks for that pattern as a fallback when the plain field isn't present.
 */
function localizedString(entity: VoyagerEntity, key: string): string | null {
  const multiLocaleKey = `multiLocale${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const value = entity[multiLocaleKey];
  if (!value || typeof value !== "object") return null;

  const locales = value as Record<string, unknown>;
  const preferred = locales.en_US;
  if (typeof preferred === "string" && preferred.trim()) return preferred.trim();

  for (const localized of Object.values(locales)) {
    if (typeof localized === "string" && localized.trim()) return localized.trim();
  }
  return null;
}

function str(entity: VoyagerEntity | undefined, ...keys: string[]): string | null {
  if (!entity) return null;
  for (const key of keys) {
    const value = entity[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    const localized = localizedString(entity, key);
    if (localized) return localized;
  }
  return null;
}

function num(entity: VoyagerEntity | undefined, ...keys: string[]): number | null {
  if (!entity) return null;
  for (const key of keys) {
    const value = entity[key];
    if (typeof value === "number") return value;
  }
  return null;
}

function toDatePoint(raw: unknown): DatePoint | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const month = typeof obj.month === "number" ? obj.month : null;
  const year = typeof obj.year === "number" ? obj.year : null;
  if (month === null && year === null) return null;
  return { month, year };
}

/**
 * Live testing against the dash API turned up positions/educations whose entities parsed
 * correctly (title, companyName, schoolName, ...) but with dates always null, meaning the
 * classic `{ timePeriod: { startDate, endDate } }` wrapper isn't (always) how the dash
 * namespace represents duration. Without confirmed documentation of the current shape, this
 * checks several plausible variants rather than committing to one that's already been
 * observed to be wrong for at least some entities.
 */
function timePeriod(entity: VoyagerEntity | undefined): {
  startDate: DatePoint | null;
  endDate: DatePoint | null;
} {
  if (!entity) return { startDate: null, endDate: null };

  const timePeriod = entity.timePeriod as Record<string, unknown> | undefined;
  if (timePeriod) {
    const startDate = toDatePoint(timePeriod.startDate);
    const endDate = toDatePoint(timePeriod.endDate);
    if (startDate || endDate) return { startDate, endDate };
  }

  const dateRange = entity.dateRange as Record<string, unknown> | undefined;
  if (dateRange) {
    const startDate = toDatePoint(dateRange.start ?? dateRange.startDate);
    const endDate = toDatePoint(dateRange.end ?? dateRange.endDate);
    if (startDate || endDate) return { startDate, endDate };
  }

  const startDate = toDatePoint(entity.startDate);
  const endDate = toDatePoint(entity.endDate);
  return { startDate, endDate };
}

const MAX_SEARCH_DEPTH = 6;

/**
 * LinkedIn represents every image (profile photo, background, company/school logo) as a
 * "VectorImage": a `rootUrl` plus a list of `artifacts`, one per rendered size. We search
 * for that shape structurally instead of hardcoding a field path, since the exact nesting
 * under `profilePicture` / `logo` / etc. has changed across LinkedIn API revisions.
 */
function findVectorImageUrl(node: unknown, depth = 0): string | null {
  if (!node || typeof node !== "object" || depth > MAX_SEARCH_DEPTH) return null;
  const obj = node as Record<string, unknown>;

  const rootUrl = obj.rootUrl;
  const artifacts = obj.artifacts;
  if (typeof rootUrl === "string" && Array.isArray(artifacts) && artifacts.length > 0) {
    const best = [...artifacts]
      .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
      .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0];
    const segment = best?.fileIdentifyingUrlPathSegment;
    if (typeof segment === "string") {
      return `${rootUrl}${segment}`;
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findVectorImageUrl(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Resolves a company/school logo via a cross-entity urn pointer, falling back to any image embedded inline. */
function findLogoUrl(entity: VoyagerEntity | undefined, resolver: UrnResolver): string | null {
  if (!entity) return null;

  const candidates: unknown[] = [entity, entity.company, entity.school];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
      if (typeof value === "string" && value.startsWith("urn:") && /company|school/i.test(key)) {
        const resolved = resolver.get(value);
        const url = findVectorImageUrl(resolved);
        if (url) return url;
      }
    }
  }

  return findVectorImageUrl(entity);
}

function resolveLocationName(profile: VoyagerEntity, resolver: UrnResolver): string | null {
  const direct = str(profile, "geoLocationName", "locationName", "location");
  if (direct) return direct;

  const geoLocation = profile.geoLocation as Record<string, unknown> | undefined;
  const geoUrn = profile["*geoLocation"] ?? geoLocation?.["*geo"];
  if (typeof geoUrn === "string") {
    const geo = resolver.get(geoUrn);
    return str(geo, "defaultLocalizedName", "name");
  }
  return null;
}

function extractExperience(resolver: UrnResolver): ExperienceEntry[] {
  return resolver.allOfType(TYPE.position).map((position) => {
    const { startDate, endDate } = timePeriod(position);
    return {
      title: str(position, "title"),
      companyName: str(position, "companyName"),
      companyLogoUrl: findLogoUrl(position, resolver),
      location: str(position, "locationName", "geoLocationName"),
      startDate,
      endDate,
      isCurrent: startDate !== null && endDate === null,
      description: str(position, "description"),
    };
  });
}

function extractEducation(resolver: UrnResolver): EducationEntry[] {
  return resolver.allOfType(TYPE.education).map((education) => {
    const { startDate, endDate } = timePeriod(education);
    return {
      schoolName: str(education, "schoolName"),
      schoolLogoUrl: findLogoUrl(education, resolver),
      degreeName: str(education, "degreeName"),
      fieldOfStudy: str(education, "fieldOfStudy"),
      startDate,
      endDate,
      description: str(education, "description"),
    };
  });
}

function extractSkills(resolver: UrnResolver): SkillEntry[] {
  const seen = new Set<string>();
  const skills: SkillEntry[] = [];
  for (const skill of resolver.allOfType(TYPE.skill)) {
    const name = str(skill, "name");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    skills.push({ name, endorsementCount: num(skill, "endorsementCount", "endorsementsCount") });
  }
  return skills;
}

function extractCertifications(resolver: UrnResolver): CertificationEntry[] {
  return resolver.allOfType(TYPE.certification).map((certification) => {
    const { startDate, endDate } = timePeriod(certification);
    return {
      name: str(certification, "name"),
      authority: str(certification, "authority"),
      licenseNumber: str(certification, "licenseNumber"),
      url: str(certification, "url"),
      startDate,
      endDate,
    };
  });
}

function extractLanguages(resolver: UrnResolver): LanguageEntry[] {
  return resolver
    .allOfType(TYPE.language)
    .map((language) => ({
      name: str(language, "name") ?? "",
      proficiency: str(language, "proficiency"),
    }))
    .filter((language) => language.name);
}

export function parseProfileView(
  raw: VoyagerProfileViewResponse,
  context: { publicIdentifier: string; profileUrl: string }
): LinkedInProfile {
  const resolver = new UrnResolver(raw.included ?? []);
  const profile = resolver.allOfType(TYPE.profile)[0];

  if (!profile) {
    throw new LinkedInProfileNotFoundError(context.publicIdentifier);
  }

  const firstName = str(profile, "firstName");
  const lastName = str(profile, "lastName");
  const name = [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    publicIdentifier: context.publicIdentifier,
    profileUrl: context.profileUrl,
    name,
    firstName,
    lastName,
    headline: str(profile, "headline"),
    location: resolveLocationName(profile, resolver),
    about: str(profile, "summary"),
    profileImageUrl: findVectorImageUrl(profile.profilePicture),
    backgroundImageUrl: findVectorImageUrl(profile.backgroundImage),
    connectionsCount: num(profile, "connectionsCount"),
    followersCount: num(profile, "followersCount"),
    experience: extractExperience(resolver),
    education: extractEducation(resolver),
    skills: extractSkills(resolver),
    certifications: extractCertifications(resolver),
    languages: extractLanguages(resolver),
    scrapedAt: new Date().toISOString(),
  };
}
