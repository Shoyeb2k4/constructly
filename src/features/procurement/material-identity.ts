import { displayMaterialName, normalizeMaterialName } from "./material-backfill";

/**
 * MATERIAL IDENTITY for filters and analytics — one rule, used by the server,
 * demo mode and the dashboard alike.
 *
 *   materialId  = identity. A linked line belongs to its Material, whatever the
 *                 Material is called today and whether or not it is archived.
 *   material    = the PO's frozen snapshot. Shown on documents; never identity
 *                 for a linked line.
 *
 * A line with no materialId (written before the Material Master existed, from
 * an older app, or whose Material row was hard-deleted — the FK is ON DELETE
 * SET NULL) is keyed by its snapshot text: `legacy:<normalized>`, where
 * normalization is only trim + collapse whitespace + case-fold. No fuzzy match.
 *
 * Deliberately NOT done: resolving an unlinked line into a Material bucket by
 * name. Name resolution evaluated at read time is not stable — rename the
 * Material "Cement" to "OPC Cement" and every unlinked "Cement" line would
 * silently fall out of its bucket; create a new "Cement" after archiving the
 * old one and they would silently jump to the new one. Identity must not move
 * when someone edits master data, so unlinked lines stay in their own clearly
 * labelled buckets until they are linked by an explicit, point-in-time act.
 */

export const LEGACY_MATERIAL_PREFIX = "legacy:";

/** The fallback identity of an unlinked line. */
export function legacyMaterialKey(snapshot: string): string {
  return LEGACY_MATERIAL_PREFIX + normalizeMaterialName(snapshot);
}

/** What analytics need to know about a Material to label its bucket. */
export interface MaterialIdentityRef {
  id: string;
  name: string;
  archived: boolean;
}

export interface MaterialBucket {
  /** Grouping identity: the materialId, or `legacy:<normalized snapshot>`. */
  key: string;
  materialId: string | null;
  /** Current Material name for a linked line (so a rename relabels the one
   *  bucket instead of splitting it); the tidied snapshot for an unlinked one. */
  label: string;
  archived: boolean;
  linked: boolean;
}

export function materialIndex(refs: readonly MaterialIdentityRef[]): Map<string, MaterialIdentityRef> {
  return new Map(refs.map((r) => [r.id, r]));
}

export function materialBucketOf(
  line: { material: string; materialId?: string | null },
  index: ReadonlyMap<string, MaterialIdentityRef>,
): MaterialBucket {
  if (line.materialId) {
    const ref = index.get(line.materialId);
    return {
      key: line.materialId,
      materialId: line.materialId,
      // A linked id the caller could not resolve still groups by id; it just
      // falls back to the snapshot for its label.
      label: ref?.name ?? displayMaterialName(line.material),
      archived: ref?.archived ?? false,
      linked: true,
    };
  }
  return {
    key: legacyMaterialKey(line.material),
    materialId: null,
    label: displayMaterialName(line.material),
    archived: false,
    linked: false,
  };
}

/**
 * The RECORDED-NAME filter (the `?material=` compatibility path): does this
 * line's snapshot text say `name`, after conservative normalization? Matches on
 * what was written on the order, linked or not — which is exactly what the old
 * exact-text filter meant, so an old bookmark or an older app never gets fewer
 * results than it used to. Identity filtering is `materialId`, not this.
 */
export function matchesRecordedName(snapshot: string, name: string): boolean {
  const want = normalizeMaterialName(name);
  return want !== "" && normalizeMaterialName(snapshot) === want;
}

export type MaterialFilterIntent =
  | { kind: "id"; materialId: string }
  | { kind: "name"; name: string }
  | null;

const isSet = (v?: string | null): v is string => v != null && v !== "ALL" && v.trim() !== "";

/**
 * Which material constraint a filter object actually asks for. `materialId`
 * wins when both keys are present, so the two can never combine into a
 * contradictory filter. Empty / "ALL" on both means no constraint at all.
 */
export function materialFilterIntent(f: { materialId?: string | null; material?: string | null }): MaterialFilterIntent {
  if (isSet(f.materialId)) return { kind: "id", materialId: f.materialId };
  if (isSet(f.material) && normalizeMaterialName(f.material) !== "") return { kind: "name", name: f.material };
  return null;
}

/**
 * Distinct recorded names on UNLINKED lines — the options for the "older
 * orders" section of the material filter. One entry per normalized key; the
 * label is the best-looking spelling seen (mixed case beats ALL CAPS beats all
 * lower, then alphabetical), so the result does not depend on row order.
 */
export function unlinkedRecordedNames(lines: Iterable<{ material: string; materialId?: string | null }>): string[] {
  const best = new Map<string, string>();
  for (const l of lines) {
    if (l.materialId) continue;
    const label = displayMaterialName(l.material);
    if (!label) continue;
    const key = label.toLowerCase();
    const cur = best.get(key);
    if (cur === undefined || spellingRank(label) < spellingRank(cur) || (spellingRank(label) === spellingRank(cur) && label < cur)) {
      best.set(key, label);
    }
  }
  return [...best.values()].sort((a, b) => a.localeCompare(b));
}

function spellingRank(s: string): number {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return 0;
  return s === s.toUpperCase() ? 1 : 2;
}

/**
 * Distinct materials of one PO for "materials supplied" rollups: deduped by
 * IDENTITY, carried as labels. Two lines of the same Material with different
 * snapshots (a rename between orders) count once.
 */
export function distinctMaterialLabels(
  lines: readonly { material: string; materialId?: string | null }[],
  index: ReadonlyMap<string, MaterialIdentityRef>,
): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const l of lines) {
    const b = materialBucketOf(l, index);
    if (!seen.has(b.key)) seen.set(b.key, b.label);
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}
