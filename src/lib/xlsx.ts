// A real .xlsx download (Excel opens it in columns whatever the PC's list separator is — a CSV can land in one column).
// The xlsx library is loaded only when someone exports.
export async function downloadXlsx(headers: string[], rows: (string | number | null | undefined)[][], filename: string, sheetName = "Sheet1") {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : v)))]);
  ws["!cols"] = headers.map((h, i) => ({ wch: Math.min(45, Math.max(h.length, ...rows.slice(0, 300).map((r) => String(r[i] ?? "").length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
}
