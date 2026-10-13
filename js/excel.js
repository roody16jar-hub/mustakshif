// Excel export / import with SheetJS (loaded on demand from cdnjs, cached by the service worker).
import { importProperties } from "./domain.js";

const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let loading = null;
export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!loading) loading = new Promise((res, rej) => { const s = document.createElement("script"); s.src = XLSX_URL; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error("xlsx load")); document.head.appendChild(s); });
  return loading;
}
/** sheets: { "اسم الورقة": [ {col: val}, ... ] } */
export async function exportWorkbook(sheets, filename) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "لا توجد بيانات": "" }]);
    ws["!cols"] = Object.keys(rows[0] || { x: 1 }).map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  wb.Workbook = { Views: [{ RTL: true }] };
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const file = new File([out], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
/** reads every sheet of an .xlsx/.csv and returns property data objects mapped from Arabic headers */
export async function importWorkbook(file) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const out = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
    out.push(...importProperties(rows));
  }
  return out;
}
