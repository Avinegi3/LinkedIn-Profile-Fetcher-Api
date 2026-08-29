import { extractPublicIdentifier } from "../utils/urlParser";
import { fetchProfileView } from "./client";
import { parseProfileView } from "./parser";
import { LinkedInProfile } from "../types/profile";

export async function getLinkedInProfile(profileUrl: string): Promise<LinkedInProfile> {
  const publicIdentifier = extractPublicIdentifier(profileUrl);
  const raw = await fetchProfileView(publicIdentifier);
  return parseProfileView(raw, {
    publicIdentifier,
    profileUrl: `https://www.linkedin.com/in/${publicIdentifier}/`,
  });
}

export { checkSession } from "./client";
export * from "./errors";
