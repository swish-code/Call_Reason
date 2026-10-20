// Shared by the server (server/talabat.ts, which summarises an uploaded Talabat Order report) and the
// Talabat Report page (which lists its orders), so both read the file and name brands the same way.

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks (the "Order items" column does). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Store names carry the brand in many spellings ("Yelo! Pizza", "Yelo Pizza Salwa", "Shawarma Shakir - Ardhiya",
// "ForeverMore"); first match wins, anything unknown keeps the text before the first comma.
const BRAND_RULES: [RegExp, string][] = [
  [/^shawarma\s*shakir/i, "Shawarma Shakir"],
  [/^yelo/i, "Yelo Pizza"],
  [/^bbt\b/i, "BBT"],
  [/^mish\s*mash/i, "Mishmash"],
  [/^tabel/i, "Tabel"],
  [/^(forever\s*more|fm\b)/i, "FM"],
  [/^slice/i, "Slice"],
  [/^pattie/i, "Pattie Pattie"],
  [/^chili/i, "Chili Pepper"],
  [/^just\s*c\b/i, "Just C"],
  [/^love\s*bird/i, "Love Bird"],
];

export function brandOf(restaurantName: string): string {
  const name = String(restaurantName || "").trim();
  for (const [re, brand] of BRAND_RULES) if (re.test(name)) return brand;
  return name.split(",")[0].trim() || "Unknown";
}
