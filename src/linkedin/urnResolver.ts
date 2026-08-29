import { VoyagerEntity } from "./client";

/**
 * Indexes a Voyager `included` array (LinkedIn's flat, JSON-API-like entity list) by
 * entityUrn so pointer fields elsewhere in the response (e.g. `"*profile": "urn:li:..."`)
 * can be dereferenced, and provides a type-based lookup as a resilience fallback for when
 * root pointer field names shift between LinkedIn API revisions.
 */
export class UrnResolver {
  private byUrn = new Map<string, VoyagerEntity>();
  private byType = new Map<string, VoyagerEntity[]>();

  constructor(included: VoyagerEntity[] = []) {
    for (const entity of included) {
      if (entity.entityUrn) {
        this.byUrn.set(entity.entityUrn, entity);
      }
      const type = entity.$type;
      if (type) {
        const bucket = this.byType.get(type) ?? [];
        bucket.push(entity);
        this.byType.set(type, bucket);
      }
    }
  }

  get(urn: string | undefined | null): VoyagerEntity | undefined {
    if (!urn) return undefined;
    return this.byUrn.get(urn);
  }

  /** All entities whose `$type` ends with any of the given suffixes (case-sensitive). */
  allOfType(...typeSuffixes: string[]): VoyagerEntity[] {
    const results: VoyagerEntity[] = [];
    for (const [type, entities] of this.byType) {
      if (typeSuffixes.some((suffix) => type.endsWith(suffix))) {
        results.push(...entities);
      }
    }
    return results;
  }

  /** Resolves a `*elements` style array of urn strings into their entities, dropping misses. */
  resolveAll(urns: unknown): VoyagerEntity[] {
    if (!Array.isArray(urns)) return [];
    return urns
      .filter((u): u is string => typeof u === "string")
      .map((u) => this.get(u))
      .filter((e): e is VoyagerEntity => Boolean(e));
  }
}
