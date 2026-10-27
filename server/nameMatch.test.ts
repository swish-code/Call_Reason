// Run: npx tsx --test server/nameMatch.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { matchBranch, resolveBrand, splitVendor, tokenize, mergeAliases, parseAliases, type NameBrand, type NameBranch } from "./nameMatch.ts";
import { BRANCH_REGISTRY } from "./branchRegistry.ts";

// Canonical names as in the database (server/db.ts BRAND_BRANCHES), then the registry aliases merged on top.
const DB: Record<string, string[]> = {
  "Yelo Pizza": ["Adaliya", "Khairan", "Jaber Al Ahmed", "Sabah Al Salem", "Vibes", "Qortuba", "Abdullah Al Salem (Dahiya)", "Fahaheel", "Jleeb Al Shuyoukh", "Egaila", "Salmiya", "Jabriya", "Ishbiliya", "Sabah Al Ahmed", "Ardhiya", "Maidan Hawally", "Yard", "Jahra", "Salwa", "Zahra", "Saad Al Abdullah", "Qurain", "Andalous"],
  "Shawarma Shakir": ["Rai", "Qurain", "Salmiya", "Kuwait City", "Jahra", "Ardhiya", "Egaila", "Hawally", "Sabah Al Ahmed", "Bayan"],
  "BBT": ["Shamiya", "Hilltop", "West Mishref", "Yard", "Salmiya", "Ardhiya", "Jahra", "Adaliya", "Shuhada", "Mangaf", "Saad Al Abdullah", "Sabah Al Ahmed", "Bayan", "Khairan", "Um Al Hyman"],
  "Slice": ["Mishref", "Kuwait City", "Yard", "Adaliya", "Jabriya", "Ardhiya", "Jahra", "Salmiya"],
  "Pattie Pattie": ["Adaliya", "Mishref", "Ardhiya", "Jahra", "Salmiya", "Yard", "Hawally"],
  "Chili Pepper": ["Qortuba", "Yard", "Hawally"],
  "Mishmash": ["Ardhiya", "Kaifan", "Mahboula", "Jabriya", "Sabah Al Salem", "Saad Al Abdullah", "Salmiya", "Khaithan", "Mangaf", "West Abdullah Al Mubarak", "Salwa", "Qadsiya", "Qurain", "Khairan"],
  "Tabel": ["Ardhiya", "Qortuba", "Hawally", "Sabah Al Salem", "Salmiya", "Bneid Al Qar", "Mahboula", "Jahra", "Ahmadi", "Khairan"],
};
const brands: NameBrand[] = []; const branchesOf = new Map<string, NameBranch[]>(); const neverOf = new Map<string, string[]>();
for (const [name, list] of Object.entries(DB)) {
  const reg = BRANCH_REGISTRY.find((r) => r.brand === name);
  const b: NameBrand = { id: name, name, aliases: reg?.brandAliases || [] };
  brands.push(b);
  branchesOf.set(name, list.map((n) => ({ id: `${name}/${n}`, name: n, aliases: reg?.branches?.find((x) => x.name === n)?.aliases || [] })));
  neverOf.set(name, reg?.neverAutoLink || []);
}
const brandOf = (n: string) => brands.find((b) => b.name === n)!;
const branch = (brandName: string, text: string) => matchBranch(text, brandOf(brandName), branchesOf.get(brandName)!, neverOf.get(brandName));
const linked = (brandName: string, text: string) => { const m = branch(brandName, text); return m.status === "matched" ? m.branch!.name : m.status; };

test("registry names all exist in the database list (a typo here would silently add nothing)", () => {
  for (const r of BRANCH_REGISTRY) {
    assert.ok(DB[r.brand] || ["Just C", "FM"].includes(r.brand), `brand ${r.brand}`);
    for (const b of r.branches || []) if (DB[r.brand]) assert.ok(DB[r.brand].includes(b.name), `${r.brand} / ${b.name}`);
  }
});

test("spelling variants of one area link to the same branch", () => {
  for (const t of ["Ardhiya", "Ardiyah", "ARD", "Ardiya-Ind-3"]) assert.equal(linked("Tabel", t), "Ardhiya", t);
});
test("brand and branch fused in one cell", () => {
  const r = resolveBrand("Tabel, Ardhiya", brands)!;
  assert.equal(r.brand.name, "Tabel");
  assert.equal(linked("Tabel", r.rest), "Ardhiya");
  const m = resolveBrand("Mishmash , Kaifan", brands)!;
  assert.equal(m.brand.name, "Mishmash"); assert.equal(m.rest, "Kaifan");
  assert.equal(resolveBrand("MishMash, West Abdullah Al-Mubarak TGO", brands)!.brand.name, "Mishmash");
  assert.equal(resolveBrand("Pattie pattie , jahra", brands)!.brand.name, "Pattie Pattie");
  assert.equal(resolveBrand("BBT（Ardiya）", brands)!.rest, "Ardiya");
  assert.deepEqual(splitVendor("Zorro Wraps, Jahra"), { brand: "Zorro Wraps", rest: "Jahra" });
  assert.deepEqual(splitVendor("Zorro Wraps - Salmiya"), { brand: "Zorro Wraps", rest: "Salmiya" });
  assert.deepEqual(splitVendor("Zorro"), { brand: "Zorro", rest: "" });
});
test("a code or filler word in the file does not stop the match", () => {
  assert.equal(linked("Mishmash", "Mangaf tgo"), "Mangaf");
  assert.equal(linked("Mishmash", "Kaifan TMP"), "Kaifan");
  assert.equal(linked("Mishmash", "Salwa Tgo"), "Salwa");
  assert.equal(linked("Mishmash", "West Abdullah Al-Mubarak TGO"), "West Abdullah Al Mubarak");
  assert.equal(linked("Tabel", "Ahmadi, Al-Ahmadi"), "Ahmadi");
});
test("names the registry teaches", () => {
  assert.equal(linked("Mishmash", "Abu Halifa, Mahboula"), "Mahboula");
  assert.equal(linked("Mishmash", "Adan"), "Sabah Al Salem");
  assert.equal(linked("Mishmash", "Firdous"), "Ardhiya");
  assert.equal(linked("Mishmash", "Surra"), "Jabriya");
  assert.equal(linked("Pattie Pattie", "Farwaniya"), "Ardhiya");
  assert.equal(linked("Pattie Pattie", "Fnaitess"), "Yard");
  assert.equal(linked("Pattie Pattie", "Mubarak Al-Abdullah - West Mishref"), "Mishref");
  assert.equal(linked("Slice", "Qibla"), "Kuwait City");
});
test("a stored alias still matches when the file decorates it with a code", () => {
  assert.equal(linked("Slice", "Qibla-13"), "Kuwait City");
});
test("different areas one or two letters apart never match", () => {
  assert.notEqual(linked("Yelo Pizza", "Zahra"), "Jahra");
  assert.equal(linked("Yelo Pizza", "Zahra"), "Zahra");
  assert.equal(linked("Yelo Pizza", "Jahra"), "Jahra");
  assert.notEqual(branch("Mishmash", "Khairan").branch?.name, "Khaithan");
  assert.equal(linked("Mishmash", "Khairan"), "Khairan");
  assert.equal(linked("Mishmash", "Khaitan"), "Khaithan");
  assert.notEqual(branch("Mishmash", "Salwa").branch?.name, "Salmiya");
  assert.notEqual(branch("Mishmash", "Salmiya").branch?.name, "Salwa");
});
test("Slicer is not the brand Slice", () => {
  assert.equal(resolveBrand("Slicer", brands), null);
  assert.equal(resolveBrand("Slice, Qibla", brands)!.brand.name, "Slice");
  assert.equal(resolveBrand("Slice Doner Qibla", brands)!.brand.name, "Slice");
});
test("the longest brand name wins", () => {
  assert.equal(resolveBrand("Pattie Pattie Sliders, Jahra", brands)!.brand.name, "Pattie Pattie");
  assert.equal(resolveBrand("Shawarma Shakir - Rai", brands)!.brand.name, "Shawarma Shakir");
});
test("a store name that names two branches is suggested, never linked", () => {
  const m = branch("BBT", "Ali Sabah Al-Salem - Umm Al Hayman");
  assert.notEqual(m.status, "matched");
});
test("a medium guess is only a suggestion; a wrong word is unknown", () => {
  assert.equal(branch("Mishmash", "Mubarak Al-Abdullah Kuwait").status === "matched", false);
  assert.equal(branch("Tabel", "Nowhere Land").status, "unknown");
});
test("the same spelling under two brands links only inside its own brand", () => {
  const a = branch("Tabel", "Ardhiya").branch!, b = branch("Mishmash", "Ardhiya").branch!;
  assert.equal(a.id, "Tabel/Ardhiya"); assert.equal(b.id, "Mishmash/Ardhiya");
  assert.notEqual(branch("Tabel", "Kaifan").status, "matched");   // Kaifan belongs to Mishmash
});
test("tokenizer", () => {
  assert.deepEqual(tokenize("Bayan,Bayan"), ["bayan"]);
  assert.deepEqual(tokenize("Egaila-5-Metro Mall"), ["egaila"]);
  assert.deepEqual(tokenize("S-Abdallah"), ["saad", "abdullah"]);
});
test("alias merging keeps what was there and never throws on bad JSON", () => {
  assert.deepEqual(mergeAliases(["Qibla"], ["qibla ", "City"]), ["Qibla", "City"]);
  assert.deepEqual(parseAliases("{not json"), []);
  assert.deepEqual(parseAliases('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseAliases(null), []);
});

test("the real Talabat file's 35 vendor names all resolve to a brand, and no branch is left unmatched or only suggested", () => {
  const vendors = ["Tabel, Ardhiya","Mishmash, Saad Al-Abdallah","Mishmash, Ardhiya","Mishmash, Khaitan","MishMash, Qurain","Tabel, Mahboula","Tabel, Sabah Al-Salem","Tabel, Jahra","Mishmash, Salmiya","Tabel, Qortuba","Tabel, Ahmadi, Al-Ahmadi","Tabel, Bneid Al Qar","Mishmash, Sabah Al Salem","Tabel, Salmiya","Mishmash, Mangaf tgo","MishMash, Salwa Tgo","Mishmash , Kaifan","MishMash, West Abdullah Al-Mubarak TGO","Mishmash, Jabriya","MishMash, Qadsiya tgo","Mishmash, Mahboula","Pattie Pattie, Farwaniya","Pattie pattie , jahra","Pattie Pattie, Fnaitess","Tabel, Hawally","Pattie Pattie,Adaliya","Pattie Pattie, Mubarak Al-Abdullah - West Mishref","Tabel, Khairan","Mishmash, Khairan","Pattie Pattie, Hawally","Mishmash, Adan","Mishmash, Firdous","Mishmash, Surra","Mishmash, Abu Halifa, Mahboula","Mishmash, Kaifan TMP"];
  const expect: Record<string, string> = { "Tabel, Ahmadi, Al-Ahmadi": "Ahmadi", "Mishmash, Saad Al-Abdallah": "Saad Al Abdullah", "Mishmash, Khaitan": "Khaithan", "MishMash, West Abdullah Al-Mubarak TGO": "West Abdullah Al Mubarak", "Pattie Pattie, Mubarak Al-Abdullah - West Mishref": "Mishref", "Pattie Pattie, Farwaniya": "Ardhiya", "Mishmash, Adan": "Sabah Al Salem", "Mishmash, Firdous": "Ardhiya", "Mishmash, Surra": "Jabriya", "Mishmash, Abu Halifa, Mahboula": "Mahboula" };
  for (const v of vendors) {
    const r = resolveBrand(v, brands);
    assert.ok(r, `brand of ${v}`);
    const m = branch(r!.brand.name, r!.rest);
    assert.equal(m.status, "matched", `${v} -> ${r!.rest} (${m.status} ${m.score})`);
    if (expect[v]) assert.equal(m.branch!.name, expect[v], v);
  }
});
