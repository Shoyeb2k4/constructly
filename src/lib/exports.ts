import * as XLSX from "xlsx";
import { saveGeneratedFile } from "@/lib/mobile/save-file";

/**
 * One way to hand a generated file to the user, for every exporter.
 *
 * `XLSX.writeFile` and jsPDF's `doc.save()` both work by clicking a hidden
 * `<a download>`. WKWebView ignores the `download` attribute, so on iOS both
 * silently do nothing — the user taps Export and gets no file, no share sheet
 * and no error. Routing every exporter through here means the native path
 * (write to cache, then share sheet) is used on a device and the browser path
 * is unchanged on the web.
 */

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Serialize a workbook in-memory and save it. Replaces `XLSX.writeFile`. */
export async function saveWorkbook(wb: XLSX.WorkBook, filename: string): Promise<void> {
  // `type: "array"` keeps this in memory instead of letting SheetJS reach for
  // the DOM download path we are trying to avoid.
  const data = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await saveGeneratedFile(new Blob([data], { type: XLSX_MIME }), filename);
}

export { saveGeneratedFile };
