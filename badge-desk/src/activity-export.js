const workbookMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const logSheetPath = "xl/worksheets/sheet1.xml";
const logTablePath = "xl/tables/table1.xml";
const starterRowPattern = /<x:row r="5"[^>]*>.*?<\/x:row>/s;

function cellText(value) {
  return String(value ?? "")
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/_x[\da-f]{4}_/gi, value => "_x005F_" + value.slice(1))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mstSerial(value) {
  if (!value) return null;
  // Phoenix is seven hours behind UTC. Excel dates are days since its 1900 epoch.
  return (Date.parse(value) - 7 * 3_600_000) / 86_400_000 + 25_569;
}

async function activityWorkbook(db) {
  const {results} = await db.prepare(select + " ORDER BY checked_out_at DESC, id DESC").all();
  if (!results.length) return Uint8Array.from(atob(assets["/activity-log.xlsx"][1]), char => char.charCodeAt(0));
  const parts = {...workbookParts};
  const sheet = parts[logSheetPath];
  const starter = sheet.match(starterRowPattern)?.[0];
  const styles = [...(starter ?? "").matchAll(/<x:c r="[A-I]5" s="(\d+)"\s*\/>/g)].map(match => match[1]);
  if (styles.length !== 9 || results.length > 1_048_572) throw new Error("Invalid activity workbook template or row count.");
  const rows = results.map((record, index) => {
    const badge = bySlug.get(record.badge);
    const values = [
      badge?.code ?? record.badge.toUpperCase(), badge?.group ?? "",
      record.first_name, record.last_name, record.phone, record.owner,
      mstSerial(record.checked_out_at), mstSerial(record.returned_at),
      record.has_photo ? "Yes" : "No"
    ];
    const row = index + 5;
    const cells = values.map((value, column) => {
      const address = String.fromCharCode(65 + column) + row;
      const tag = `<x:c r="${address}" s="${styles[column]}"`;
      if (typeof value === "number") return `${tag}><x:v>${value}</x:v></x:c>`;
      if (!value) return tag + " />";
      return `${tag} t="inlineStr"><x:is><x:t xml:space="preserve">${cellText(value)}</x:t></x:is></x:c>`;
    });
    return `<x:row r="${row}" ht="22" customHeight="1">${cells.join("")}</x:row>`;
  }).join("");
  const lastRow = results.length + 4;
  parts[logSheetPath] = sheet.replace(starterRowPattern, () => rows)
    .replace('ref="A1:I5"', `ref="A1:I${lastRow}"`);
  parts[logTablePath] = parts[logTablePath].replaceAll('ref="A4:I5"', `ref="A4:I${lastRow}"`);
  const zip = new JSZip();
  for (const [filename, contents] of Object.entries(parts)) zip.file(filename, contents);
  return zip.generateAsync({type:"uint8array", compression:"DEFLATE"});
}
