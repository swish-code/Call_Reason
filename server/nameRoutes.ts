// Fixing brand / branch names after an upload (files import in one go, so nobody is asked first), and the admin alias editor.
import { DB, pool } from "./db.js";
import { loadCatalog, stampRatingNames, exportAliases } from "./nameRegistry.js";
import { matchBranch, mergeAliases, normalize, parseAliases } from "./nameMatch.js";

type Mw = (req: any, res: any, next: any) => any;
interface Deps {
  auth: Mw; manage: Mw; adminOnly: Mw;
  triage: (rating: number, text: string | undefined, phone: string) => { isTask: boolean; action_status: string; requires_action: boolean };
}

const SQL_NORM = (col: string) => `lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`;

export function registerNameRoutes(app: any, d: Deps) {
  const wrap = (fn: (req: any, res: any) => Promise<any>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

  // Brands with their branches and aliases (the pickers and the admin editor).
  app.get("/api/name-registry", d.auth, d.manage, wrap(async (_req, res) => {
    const cat = await loadCatalog();
    res.json(cat.brands.map((b) => ({ id: b.id, name: b.name, aliases: b.aliases, branches: (cat.branches.get(b.id) || []).map((x) => ({ id: x.id, name: x.name, aliases: x.aliases })) })));
  }));

  // What still needs a person: branch spellings that matched nothing, and rows held back for an unknown brand.
  app.get("/api/name-registry/pending", d.auth, d.manage, wrap(async (_req, res) => {
    const cat = await loadCatalog();
    const un = (await pool.query(
      `SELECT r.brand_id, b.brand_name, COALESCE(r.branch_raw, r.branch) AS raw, count(*)::int AS n
       FROM ratings r JOIN brands b ON b.id = r.brand_id WHERE r.name_status = 'unmatched'
       GROUP BY r.brand_id, b.brand_name, COALESCE(r.branch_raw, r.branch) ORDER BY n DESC LIMIT 300`)).rows as any[];
    const branches = un.map((u) => {
      const brand = cat.brands.find((b) => b.id === u.brand_id)!;
      const m = brand ? matchBranch(u.raw, brand, cat.branches.get(brand.id) || [], cat.neverAutoLink.get(brand.id) || []) : null;
      return { brand_id: u.brand_id, brand_name: u.brand_name, raw: u.raw, count: u.n, suggestions: m?.suggestions || [] };
    });
    const held = (await pool.query(
      "SELECT raw_brand AS raw, count(*)::int AS n FROM rating_held_rows WHERE status = 'open' GROUP BY raw_brand ORDER BY n DESC LIMIT 100")).rows as any[];
    res.json({
      branches, held_brands: held.map((h) => ({ raw: h.raw, count: h.n })),
      total_unmatched: branches.reduce((s, x) => s + x.count, 0), total_held: held.reduce((s, x) => s + x.n, 0),
    });
  }));

  // Say which branch a spelling is. Also fixes every order already stored with that spelling, in every month.
  app.post("/api/name-registry/resolve-branch", d.auth, d.manage, wrap(async (req, res) => {
    const { brand_id, raw, branch_id, new_branch_name, remember } = req.body || {};
    const cat = await loadCatalog();
    const brand = cat.brands.find((b) => b.id === brand_id);
    if (!brand || !String(raw || "").trim()) return res.status(400).json({ error: "Pick the brand and the name to fix." });
    const mine = cat.branches.get(brand.id) || [];
    let target = mine.find((b) => b.id === branch_id);
    if (!target && branch_id) {
      const other = (await pool.query("SELECT branch_name, brand FROM branches WHERE id = $1", [branch_id])).rows[0];
      if (other) return res.status(400).json({ error: `"${other.branch_name}" belongs to ${other.brand || "another brand"}, not ${brand.name}. A name is only ever matched inside its own brand.` });
      return res.status(404).json({ error: "Branch not found." });
    }
    if (!target && String(new_branch_name || "").trim()) {
      const nm = String(new_branch_name).trim().replace(/\s+/g, " ");
      target = mine.find((b) => normalize(b.name) === normalize(nm));
      if (!target) {
        const id = "br-" + Date.now();
        await pool.query("INSERT INTO branches (id, branch_name, brand) VALUES ($1,$2,$3)", [id, nm, brand.name]);
        target = { id, name: nm, aliases: [] };
      }
    }
    if (!target) return res.status(400).json({ error: "Pick a branch, or type the name of a new one." });

    const rawClean = String(raw).trim().replace(/\s+/g, " ");
    if (remember !== false && normalize(rawClean) !== normalize(target.name)) {
      const clash = mine.find((b) => b.id !== target!.id && [b.name, ...b.aliases].some((k) => normalize(k) === normalize(rawClean)));
      if (clash) return res.status(409).json({ error: `"${rawClean}" is already a name of ${clash.name}.` });
      await pool.query("UPDATE branches SET aliases = $1 WHERE id = $2", [JSON.stringify(mergeAliases(target.aliases, [rawClean])), target.id]);
    }
    const upd = await pool.query(
      `UPDATE ratings SET branch = $1, branch_id = $2, name_status = 'matched'
       WHERE brand_id = $3 AND name_status = 'unmatched' AND ${SQL_NORM("COALESCE(branch_raw, branch)")} = $4`,
      [target.name, target.id, brand.id, normalize(rawClean)]);
    req.auditExtra = { details: `${brand.name}: "${rawClean}" is ${target.name} (${upd.rowCount} order(s) fixed${remember !== false ? ", remembered" : ""})` };
    res.json({ fixed: upd.rowCount || 0, branch: { id: target.id, name: target.name } });
  }));

  // Say which brand a spelling is; the rows that were held back for it are then imported.
  app.post("/api/name-registry/resolve-brand", d.auth, d.manage, wrap(async (req, res) => {
    const { raw, brand_id, remember } = req.body || {};
    let cat = await loadCatalog();
    const brand = cat.brands.find((b) => b.id === brand_id);
    const rawClean = String(raw || "").trim().replace(/\s+/g, " ");
    if (!brand || !rawClean) return res.status(400).json({ error: "Pick the brand and the name to fix." });
    if (remember !== false && normalize(rawClean) !== normalize(brand.name)) {
      const clash = cat.brands.find((b) => b.id !== brand.id && [b.name, ...b.aliases].some((k) => normalize(k) === normalize(rawClean)));
      if (clash) return res.status(409).json({ error: `"${rawClean}" is already a name of ${clash.name}.` });
      await pool.query("UPDATE brands SET aliases = $1 WHERE id = $2", [JSON.stringify(mergeAliases(brand.aliases, [rawClean])), brand.id]);
      cat = await loadCatalog();
    }
    const b2 = cat.brands.find((b) => b.id === brand.id)!;
    const held = (await pool.query(`SELECT id, row_data FROM rating_held_rows WHERE status = 'open' AND ${SQL_NORM("raw_brand")} = $1`, [normalize(rawClean)])).rows as any[];
    const agents = (await DB.getUsers()).filter((u: any) => u.role === "agent" && u.status === "Active" && u.department === "Call Center").map((u: any) => u.id);
    let imported = 0, already = 0, ptr = 0, unmatched = 0;
    for (const h of held) {
      const f = h.row_data;
      const m = f.raw_branch ? matchBranch(f.raw_branch, b2, cat.branches.get(b2.id) || [], cat.neverAutoLink.get(b2.id) || []) : null;
      const linked = m?.status === "matched" ? m.branch : null;
      const t = d.triage(f.rating, f.review_text, f.customer_phone || "");
      const outcome = await DB.upsertRating({
        brand_id: b2.id, platform_id: f.platform_id, order_id: f.order_id, rating: f.rating, review_text: f.review_text, customer_phone: f.customer_phone,
        requires_action: t.requires_action, action_status: t.action_status, assigned_agent_id: t.isTask && agents.length ? agents[ptr++ % agents.length] : null,
        uploaded_by: f.uploaded_by, order_date: f.order_date, customer_name: f.customer_name, branch: linked ? linked.name : f.raw_branch,
        filled_by: f.filled_by, following_date: f.following_date, surveyed_by: f.surveyed_by, complaint_type: f.complaint_type,
        complaint_cases: f.complaint_cases, complaint_status: f.complaint_status, served_by: f.served_by,
      }, "skip");
      if (outcome === "inserted") imported++; else already++;
      if (outcome === "inserted" && f.raw_branch) {
        await stampRatingNames({ brand_id: b2.id, platform_id: f.platform_id, order_id: f.order_id }, { branch: linked ? linked.name : f.raw_branch, branch_raw: f.raw_branch, branch_id: linked?.id ?? null, status: linked ? "matched" : "unmatched" });
        if (!linked) unmatched++;
      }
      await pool.query("UPDATE rating_held_rows SET status = 'resolved' WHERE id = $1", [h.id]);
    }
    req.auditExtra = { details: `"${rawClean}" is ${brand.name}: ${imported} held review(s) imported, ${already} already existed` };
    res.json({ imported, already_existed: already, branch_unmatched: unmatched });
  }));

  // Admin editor: set a brand's or a branch's alias list directly.
  app.put("/api/name-registry/aliases", d.auth, d.adminOnly, wrap(async (req, res) => {
    const { kind, id } = req.body || {};
    const aliases = mergeAliases([], Array.isArray(req.body?.aliases) ? req.body.aliases.map(String) : []);
    const cat = await loadCatalog();
    if (kind === "brand") {
      const b = cat.brands.find((x) => x.id === id);
      if (!b) return res.status(404).json({ error: "Brand not found." });
      const clash = aliases.find((a) => cat.brands.some((o) => o.id !== id && [o.name, ...o.aliases].some((k) => normalize(k) === normalize(a))));
      if (clash) return res.status(409).json({ error: `"${clash}" already belongs to another brand.` });
      await pool.query("UPDATE brands SET aliases = $1 WHERE id = $2", [JSON.stringify(aliases), id]);
    } else if (kind === "branch") {
      const brandOf = [...cat.branches.entries()].find(([, list]) => list.some((x) => x.id === id));
      if (!brandOf) return res.status(404).json({ error: "Branch not found." });
      const clash = aliases.find((a) => brandOf[1].some((o) => o.id !== id && [o.name, ...o.aliases].some((k) => normalize(k) === normalize(a))));
      if (clash) return res.status(409).json({ error: `"${clash}" already belongs to another branch of this brand.` });
      await pool.query("UPDATE branches SET aliases = $1 WHERE id = $2", [JSON.stringify(aliases), id]);
    } else return res.status(400).json({ error: "kind must be brand or branch." });
    res.json({ aliases });
  }));

  // Everything taught so far, to keep in the repo as server/learned-aliases.json.
  app.get("/api/name-registry/export", d.auth, d.adminOnly, wrap(async (_req, res) => { res.json(await exportAliases()); }));
}

export { parseAliases };
