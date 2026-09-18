/**
 * Vendor materials from OLDER CLIENTS — the transition rule, as pure code.
 *
 * The mobile app shipped before the Material Master sends a vendor's materials
 * only as `materialsSupplied: string[]`, and it sends that list on EVERY create
 * and EVERY edit: the complete list, as it last showed it to the user (it reads
 * the list back from `materialsSupplied`, which the server keeps as a mirror of
 * the canonical VendorMaterial mappings).
 *
 * Taking that list at face value would let an old app desynchronise the
 * canonical mappings; ignoring it would let the two drift apart. This module
 * reconciles them without ever guessing and without ever losing information:
 *
 *  - A name maps to a material only on an EXACT normalized match, using the
 *    migration's own rule (normalizeMaterialName). "Cement" never becomes
 *    "OPC Cement".
 *  - No material is ever created from typed text. A name with no exact match is
 *    kept verbatim in the legacy column — never discarded, never promoted.
 *  - A mapping is REMOVED only on proof of intent: its name was in the list the
 *    old app was shown, and is absent from what it sent back. A mapping the app
 *    never displayed (e.g. its material was renamed since) is left alone.
 *  - An archived material may be KEPT on a vendor already mapped to it, never
 *    newly added — the same rule as the new-client path.
 *
 * Pure: no I/O. The server action and the demo repository both call it, so the
 * two cannot drift.
 */
import { displayMaterialName, normalizeMaterialName } from "./material-backfill";

export interface MasterMaterialRef {
  id: string;
  name: string;
  isActive: boolean;
}

export interface LegacyMaterialsPlan {
  /** The vendor's canonical mapping set after this save. */
  finalIds: string[];
  added: string[];
  removed: string[];
  /** Submitted names with no exact match — kept as legacy text only. */
  unmatched: string[];
  /** What to write to `materialsSupplied`. */
  mirror: string[];
}

/** Trim, collapse whitespace, drop blanks and normalized duplicates (first wins). */
function cleanNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const display = displayMaterialName(raw);
    if (!display) continue;
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(display);
  }
  return out;
}

/**
 * The legacy column: canonical names first, then any legacy-only text that is
 * not already represented by a canonical name.
 */
export function buildMirror(canonicalNames: readonly string[], legacyExtras: readonly string[]): string[] {
  const canonical = cleanNames(canonicalNames).sort((a, b) => a.localeCompare(b));
  const taken = new Set(canonical.map(normalizeMaterialName));
  const extras = cleanNames(legacyExtras).filter((e) => !taken.has(normalizeMaterialName(e)));
  return [...canonical, ...extras];
}

/**
 * Legacy-only names on a vendor: entries of `materialsSupplied` that do not
 * correspond to any of its canonical mappings. These are what an older app
 * recorded that the Material Master does not (yet) know — surfaced read-only,
 * and carried forward on every save rather than silently dropped.
 */
export function unlinkedLegacyNames(
  column: readonly string[],
  canonicalNames: readonly string[],
): string[] {
  const linked = new Set(canonicalNames.map(normalizeMaterialName));
  return cleanNames(column).filter((n) => !linked.has(normalizeMaterialName(n)));
}

/**
 * Resolve an old client's full `materialsSupplied` list against the vendor's
 * current state. See the module comment for the rules.
 */
export function planLegacyVendorMaterials(args: {
  submitted: readonly string[];
  /** The column BEFORE this save — what the old app was shown. */
  previousColumn: readonly string[];
  /** The vendor's current canonical mappings. */
  current: readonly MasterMaterialRef[];
  /** Every material in the company, archived included. */
  master: readonly MasterMaterialRef[];
}): LegacyMaterialsPlan {
  const submitted = cleanNames(args.submitted);
  const currentIds = new Set(args.current.map((m) => m.id));

  const byNorm = new Map<string, MasterMaterialRef[]>();
  for (const m of args.master) {
    const key = normalizeMaterialName(m.name);
    byNorm.set(key, [...(byNorm.get(key) ?? []), m]);
  }

  const matched = new Set<string>();
  const unmatched: string[] = [];
  for (const name of submitted) {
    const candidates = byNorm.get(normalizeMaterialName(name)) ?? [];
    // 1. The name already corresponds to one of the vendor's mappings → keep
    //    that one and change nothing (this is also how an archived link
    //    survives an old app's save).
    // 2. Otherwise exactly one LIVE material has that name → map it.
    // 3. Anything else — no match, several live matches, or only an archived
    //    one — is not guessed at: the name stays as legacy text.
    const mapped = candidates.find((c) => currentIds.has(c.id));
    const active = candidates.filter((c) => c.isActive);
    const pick = mapped ?? (active.length === 1 ? active[0] : undefined);
    if (pick) matched.add(pick.id);
    else unmatched.push(name);
  }

  // Removal needs proof: shown to the old app (previous column) and not sent back.
  const shown = new Set(args.previousColumn.map(normalizeMaterialName));
  const sentBack = new Set(submitted.map(normalizeMaterialName));
  const removed = args.current
    .filter((m) => {
      const key = normalizeMaterialName(m.name);
      return shown.has(key) && !sentBack.has(key) && !matched.has(m.id);
    })
    .map((m) => m.id);

  const removedSet = new Set(removed);
  const finalIds = [...new Set([...args.current.map((m) => m.id).filter((id) => !removedSet.has(id)), ...matched])];
  const added = finalIds.filter((id) => !currentIds.has(id));

  const nameById = new Map(args.master.map((m) => [m.id, m.name]));
  const canonicalNames = finalIds.map((id) => nameById.get(id)).filter((n): n is string => !!n);

  return {
    finalIds,
    added,
    removed,
    unmatched,
    mirror: buildMirror(canonicalNames, unmatched),
  };
}
