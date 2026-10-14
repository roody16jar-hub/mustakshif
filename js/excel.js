// Excel export / import. SheetJS (cdnjs) for the full export and the old-tracker import;
// ExcelJS (cdnjs) for the office handover report because it can embed the first photos.
import { importProperties } from "./domain.js";

const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const EXCELJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
const loaders = {};
function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!loaders[url]) loaders[url] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = url; s.onload = () => res(window[globalName]); s.onerror = () => rej(new Error("load " + url)); document.head.appendChild(s); });
  return loaders[url];
}
export const loadXlsx = () => loadScript(XLSX_URL, "XLSX");
export const loadExcelJS = () => loadScript(EXCELJS_URL, "ExcelJS");

async function deliver(bytes, filename, mime) {
  const file = new File([bytes], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
  await deliver(XLSX.write(wb, { bookType: "xlsx", type: "array" }), filename, XLSX_MIME);
}

/** office handover: rows (already sanitised) + up to 3 photo blobs per row embedded + the handover log sheet */
export async function exportHandoverXlsx(rows, photosPerRow, logRows, filename) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook(); wb.views = [{ rightToLeft: true }];
  const ws = wb.addWorksheet("تسليم المكتب", { views: [{ rightToLeft: true }] });
  const cols = Object.keys(rows[0] || {});
  ws.columns = [...cols.map(k => ({ header: k, key: k, width: 18 })), ...[1, 2, 3].map(i => ({ header: `صورة ${i}`, key: `ph${i}`, width: 22 }))];
  ws.getRow(1).font = { bold: true };
  for (let i = 0; i < rows.length; i++) {
    const r = ws.addRow(rows[i]); r.height = 110; r.alignment = { vertical: "top", wrapText: true };
    const photos = (photosPerRow[i] || []).slice(0, 3);
    for (let j = 0; j < photos.length; j++) {
      const b64 = await blobToBase64(photos[j]);
      const id = wb.addImage({ base64: b64, extension: "jpeg" });
      ws.addImage(id, { tl: { col: cols.length + j, row: i + 1 }, ext: { width: 150, height: 140 } });
    }
  }
  const log = wb.addWorksheet("سجل التسليم", { views: [{ rightToLeft: true }] });
  const lcols = Object.keys(logRows[0] || { "التاريخ": "" });
  log.columns = lcols.map(k => ({ header: k, key: k, width: 20 })); log.getRow(1).font = { bold: true };
  for (const r of logRows) log.addRow(r);
  await deliver(await wb.xlsx.writeBuffer(), filename, XLSX_MIME);
}
const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

/** reads every sheet of an .xlsx/.csv and returns property data objects mapped from Arabic headers */
export async function importWorkbook(file) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const out = [];
  for (const name of wb.SheetNames) out.push(...importProperties(XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" })));
  return out;
}
