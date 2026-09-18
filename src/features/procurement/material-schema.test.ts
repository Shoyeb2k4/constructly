import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for the Material Master foundation.
 *
 * The guarantees below are ENFORCED BY POSTGRES (constraints, indexes, RLS) and
 * by Prisma's generated types — not by this file. What this file does is lock
 * their SHAPE, so a later edit cannot quietly weaken them: drop the partial
 * unique index down to a plain one, make the case-insensitivity go away, turn a
 * composite tenant FK into a single-column one, add a NOT NULL that would
 * invalidate every historical PO line, or slip a destructive statement into a
 * migration advertised as additive. Same approach, and the same limits, as
 * features/branding/storage-rls.test.ts.
 *
 * It proves the migration DECLARES these properties. It cannot prove Postgres
 * accepted them against live data — that is what the migration's own POSTFLIGHT
 * assertion block does, at apply time.
 */

const root = process.cwd();

/** Read with line endings normalized. Git hands these files back as CRLF on a
 *  Windows checkout, and JS `.` does not match `\r` — without this, the comment
 *  stripper below silently becomes a no-op and the "additive only" assertions
 *  would be reading the commented-out rollback SQL. */
function readNormalized(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
}

const migration = readNormalized("prisma", "migration-material-master.sql");
const schema = readNormalized("prisma", "schema.prisma");

/** The migration with every `--` comment removed, so commented-out rollback
 *  statements can't satisfy (or trip) an assertion about executable SQL. */
const executable = migration
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

/** The body of one `model X { … }` block in schema.prisma. */
function model(name: string): string {
  const m = new RegExp(`^model ${name} \\{$([\\s\\S]*?)^\\}$`, "m").exec(schema);
  if (!m) throw new Error(`model ${name} not found in schema.prisma`);
  return m[1];
}

describe("Material — active name uniqueness", () => {
  it("is CASE-INSENSITIVE: 'Cement' and 'cement' cannot both be active", () => {
    // A plain (company_id, name) unique index would let both exist. The index
    // must key on lower(name).
    expect(executable).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "materials_company_name_active_key"\s+ON "materials" \("company_id", lower\("name"\)\)/,
    );
  });

  it("is scoped per company: two companies may each have an active 'Cement'", () => {
    // company_id is the leading column of the unique key, so uniqueness never
    // spans tenants.
    const idx = /ON "materials" \((("[a-z_]+"|lower\("[a-z_]+"\))(, )?)+\)/.exec(executable)![0];
    expect(idx).toContain('"company_id"');
    expect(idx.indexOf('"company_id"')).toBeLessThan(idx.indexOf("lower("));
  });

  it("applies to ACTIVE rows only, so a deactivated name can be reused", () => {
    const stmt = executable.slice(executable.indexOf("materials_company_name_active_key"));
    expect(stmt.slice(0, 200)).toMatch(/WHERE "deleted_at" IS NULL/);
  });

  it("keeps the deactivated row rather than deleting it, so history resolves", () => {
    expect(model("Material")).toMatch(/deletedAt\s+DateTime\?\s+@map\("deleted_at"\)/);
    expect(model("Material")).toMatch(/deletedById\s+String\?\s+@map\("deleted_by_id"\)/);
    // Removing the acting user must not destroy master data.
    expect(executable).toMatch(
      /materials_deleted_by_id_fkey[\s\S]{0,220}REFERENCES "users"\("id"\)\s+ON DELETE SET NULL/,
    );
  });

  it("does not declare a compile-time @@unique on name — Prisma cannot express it", () => {
    // If someone "helpfully" adds @@unique([companyId, name]), it would be
    // case-SENSITIVE and would not exempt deactivated rows: a silent weakening.
    expect(model("Material")).not.toMatch(/@@unique\(\[companyId, name\]\)/);
  });
});

describe("VendorMaterial — duplicates and tenant integrity", () => {
  it("makes a duplicate vendor↔material mapping structurally impossible", () => {
    expect(executable).toMatch(
      /CONSTRAINT "vendor_materials_pkey" PRIMARY KEY \("vendor_id", "material_id"\)/,
    );
    expect(model("VendorMaterial")).toMatch(/@@id\(\[vendorId, materialId\]\)/);
  });

  it("prevents a cross-company link with COMPOSITE foreign keys, not just filtering", () => {
    expect(executable).toMatch(
      /FOREIGN KEY \("vendor_id", "company_id"\) REFERENCES "vendors"\("id", "company_id"\)/,
    );
    expect(executable).toMatch(
      /FOREIGN KEY \("material_id", "company_id"\) REFERENCES "materials"\("id", "company_id"\)/,
    );
  });

  it("creates the compound uniques those composite FKs require on both parents", () => {
    expect(executable).toMatch(/"vendors_id_company_id_key" UNIQUE \("id", "company_id"\)/);
    expect(executable).toMatch(/"materials_id_company_id_key" UNIQUE \("id", "company_id"\)/);
    expect(model("Vendor")).toMatch(/@@unique\(\[id, companyId\]\)/);
    expect(model("Material")).toMatch(/@@unique\(\[id, companyId\]\)/);
  });

  it("is eligibility only — it carries nothing transactional", () => {
    const table = executable.slice(
      executable.indexOf('CREATE TABLE IF NOT EXISTS "vendor_materials"'),
      executable.indexOf("vendor_materials_company_id_material_id_idx"),
    );
    for (const banned of ["quantity", "qty", "amount", "paise", "received", "ordered", "rate"]) {
      expect(table.toLowerCase(), `vendor_materials must not store ${banned}`).not.toContain(banned);
    }
    // Exactly the four intended columns.
    const body = model("VendorMaterial");
    const scalars = [...body.matchAll(/^\s{2}(\w+)\s+(String|DateTime|Int|BigInt|Decimal|Boolean)/gm)].map(
      (m) => m[1],
    );
    expect(scalars.sort()).toEqual(["companyId", "createdAt", "materialId", "vendorId"]);
  });

  it("cannot reach a purchase order, so unlinking can never alter one", () => {
    // No FK, no relation and no column on vendor_materials points at POs,
    // PO lines or goods receipts — the only way to touch history from here.
    const start = executable.indexOf('CREATE TABLE IF NOT EXISTS "vendor_materials"');
    const end = executable.indexOf('ALTER TABLE "po_line_items"'); // start of section 4
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const table = executable.slice(start, end);
    for (const t of ["purchase_orders", "po_line_items", "goods_receipt"]) {
      expect(table).not.toContain(t);
    }
    expect(model("VendorMaterial")).not.toMatch(/PurchaseOrder|POLineItem|GoodsReceipt/);
  });
});

describe("POLineItem — historical rows stay valid", () => {
  it("adds material_id as NULLABLE, with no NOT NULL and no default", () => {
    const add = /ALTER TABLE "po_line_items"\s+ADD COLUMN IF NOT EXISTS "material_id" UUID;/.exec(
      executable,
    );
    expect(add, "material_id must be added plainly nullable").not.toBeNull();
    expect(model("POLineItem")).toMatch(/materialId\s+String\?\s+@map\("material_id"\)/);
  });

  it("never backfills or requires material_id on existing lines", () => {
    // Pass 1 deliberately does not reconcile historical free-text materials.
    expect(executable).not.toMatch(/UPDATE\s+"?po_line_items"?/i);
    expect(executable).not.toMatch(/ALTER COLUMN "material_id" SET NOT NULL/i);
  });

  it("can reference a material, and loses only the key if one is ever hard-deleted", () => {
    expect(executable).toMatch(
      /po_line_items_material_id_fkey[\s\S]{0,240}REFERENCES "materials"\("id"\)\s+ON DELETE SET NULL/,
    );
    expect(model("POLineItem")).toMatch(
      /materialRef\s+Material\?\s+@relation\(fields: \[materialId\], references: \[id\], onDelete: SetNull\)/,
    );
  });

  it("keeps `material` as a required frozen snapshot, not a computed field", () => {
    // Still a plain required scalar: no ?, no @default, no relation.
    expect(model("POLineItem")).toMatch(/^\s{2}material\s{8}String$/m);
    // And the migration never touches that column.
    expect(executable).not.toMatch(/ALTER TABLE "po_line_items"[\s\S]{0,120}(DROP|ALTER) COLUMN "material"/i);
  });

  it("nothing rewrites the snapshot when a material is renamed", () => {
    // A trigger or rule would be the only way a rename could propagate.
    expect(executable).not.toMatch(/CREATE\s+(OR REPLACE\s+)?(TRIGGER|RULE)/i);
    expect(executable).not.toMatch(/GENERATED ALWAYS AS/i);
  });
});

describe("tenant isolation (RLS)", () => {
  it("enables RLS on both new tables", () => {
    expect(executable).toMatch(/ALTER TABLE public\.materials ENABLE ROW LEVEL SECURITY/);
    expect(executable).toMatch(/ALTER TABLE public\.vendor_materials ENABLE ROW LEVEL SECURITY/);
  });

  it("scopes both policies to the caller's company on read AND write", () => {
    for (const table of ["materials", "vendor_materials"]) {
      const policy = executable.slice(executable.indexOf(`CREATE POLICY ${table}_tenant`));
      const head = policy.slice(0, 300);
      expect(head).toMatch(/USING \(company_id = public\.current_company_id\(\)\)/);
      expect(head).toMatch(/WITH CHECK \(company_id = public\.current_company_id\(\)\)/);
    }
  });
});

describe("migration is additive — existing data survives", () => {
  it("drops nothing and deletes nothing", () => {
    expect(executable).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|POLICY)\b/i);
    expect(executable).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(executable).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("never writes to vendors — materials_supplied is read-only here and retained", () => {
    expect(executable).not.toMatch(/UPDATE\s+"?vendors"?\s/i);
    expect(executable).not.toMatch(/materials_supplied"?\s*=/i);
    // Still declared on the model; removing it belongs to a much later pass.
    expect(model("Vendor")).toMatch(/materialsSupplied\s+String\[\]\s+@default\(\[\]\)/);
  });

  it("only ever INSERTs into the two new tables", () => {
    const targets = [...executable.matchAll(/INSERT INTO\s+"?([a-z_]+)"?/gi)].map((m) => m[1]);
    expect(new Set(targets)).toEqual(new Set(["materials", "vendor_materials"]));
  });
});

describe("backfill rule matches its tested TypeScript specification", () => {
  it("normalizes with the same trim / whitespace-collapse / lowercase rule", () => {
    // Mirrors displayMaterialName + normalizeMaterialName in material-backfill.ts.
    expect(executable).toMatch(/btrim\(regexp_replace\(raw\.name, '\\s\+', ' ', 'g'\)\)/);
    expect(executable).toMatch(/lower\(btrim\(regexp_replace\(raw\.name, '\\s\+', ' ', 'g'\)\)\)/);
  });

  it("ranks the display spelling by case quality, then usage, then name", () => {
    const ranking = executable.slice(executable.indexOf("row_number() OVER"));
    const head = ranking.slice(0, 600);
    expect(head).toMatch(/lower\(display_name\)[\s\S]*?upper\(display_name\)/); // mixed-case test
    expect(head).toMatch(/uses DESC/);
    expect(head).toMatch(/display_name\s*\n?\s*\) AS rn/);
  });

  it("groups per company, so a backfilled material is never shared across tenants", () => {
    expect(executable).toMatch(/PARTITION BY company_id, norm_name/);
    expect(executable).toMatch(/ON m\."company_id" = e\.company_id/);
  });

  it("is re-run tolerant rather than duplicating rows", () => {
    expect(executable).toMatch(
      /ON CONFLICT \("company_id", lower\("name"\)\) WHERE "deleted_at" IS NULL\s*\n?\s*DO NOTHING/,
    );
    expect(executable).toMatch(/ON CONFLICT \("vendor_id", "material_id"\) DO NOTHING/);
  });

  it("seeds from vendor arrays only — historical PO text is left for a later pass", () => {
    const inserts = executable.slice(executable.indexOf("WITH exploded AS"));
    expect(inserts).toContain('unnest(v."materials_supplied")');
    expect(inserts).not.toMatch(/FROM\s+"?po_line_items"?/i);
  });
});
