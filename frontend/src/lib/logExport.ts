// Merges the CSV exports of several cluster nodes into one file with a
// leading Node column, in the same time order Technitium writes (oldest
// first). Rows are never parsed past the first two fields, so quoted
// answers pass through untouched.

const BOM = "﻿"

export interface NodeCsv {
  node: string
  text: string
}

// RowNumber,Timestamp,... : RowNumber has no commas, so the timestamp is the
// second field.
function timestampOf(line: string): string {
  const first = line.indexOf(",")
  if (first < 0) return ""
  const second = line.indexOf(",", first + 1)
  return line.slice(first + 1, second < 0 ? undefined : second)
}

export function mergeCsv(files: NodeCsv[]): string {
  let header = ""
  const rows: { at: string; line: string }[] = []
  for (const f of files) {
    const lines = f.text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0)
    if (lines.length === 0) continue
    if (!header) header = lines[0]!
    for (const line of lines.slice(1)) rows.push({ at: timestampOf(line), line: `${f.node},${line}` })
  }
  if (!header) return ""
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return `${BOM}Node,${header}\n${rows.map((r) => r.line).join("\n")}\n`
}
