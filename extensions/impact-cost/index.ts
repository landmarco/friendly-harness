/**
 * Impact Cost - environmental impact in the session footer + ledger writer.
 *
 * Updates the pi session footer with electricity, carbon, and water alongside
 * the dollar meter (and the subagent-cost line):
 *
 *   ◆ impact: 0.03 kWh · 0.01 kgCO2e · 0.05 L
 *
 * Every time a message lands, the extension appends the message's raw usage
 * row (tokens + cost, NOT derived impact) to the gitignored ledger at
 * impact/ledger.jsonl. Impact values are derived at display time from
 * impact/config.json, so editing an assumption re-computes everything -
 * past data included. The ledger survives session-file compaction (rewind
 * hook) and is deduped by fingerprint, so re-scans never double-count.
 *
 * The shared engine lives in <harness>/impact/impact-core.mjs. Pi loads
 * extensions through the .pi/agent/extensions symlink, so the real path must
 * be resolved before importing.
 */

import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const realExtDir = dirname(realpathSync(dirname(fileURLToPath(import.meta.url))));
const coreUrl = new URL("../../impact/impact-core.mjs", "file://" + realExtDir + "/impact-cost/").href;
const core = await import(coreUrl);

const STATUS_KEY = "impact-cost";

/** Last byte offset read per session file, so appends are cheap. */
const filePos = new Map<string, number>();

function sessionIdOf(ctx: any): string {
  const direct = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const file = ctx?.sessionManager?.getSessionFile?.();
  return typeof file === "string" && file.length > 0 ? file : "";
}

function sessionFileOf(ctx: any): string {
  return ctx?.sessionManager?.getSessionFile?.() ?? "";
}

/** Return rows for assistant messages newer than the last seen file offset. */
function newSessionRows(sessionFile: string, sessionId: string, cwd: string): any[] {
  if (!sessionFile || !existsSync(sessionFile)) return [];
  const size = statSync(sessionFile).size;
  const from = filePos.get(sessionFile) ?? 0;
  const rows: any[] = [];
  if (size <= from) return rows;
  try {
    const text = readFileSync(sessionFile, { encoding: "utf8", start: from });
    let id = "";
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === "session") id = o.id || sessionId;
        if (o.type !== "message" || !o.message?.usage) continue;
        const m = o.message;
        if (m.role === "assistant") {
          rows.push({
            sessionId: id || sessionId,
            cwd,
            project: (cwd.split("/").pop() || cwd).replace(/^--|--$/g, ""),
            ts: o.timestamp || new Date().toISOString(),
            model: m.model || "",
            provider: m.provider || (m.model || "").split("/")[0],
            input: m.usage.input || 0,
            output: m.usage.output || 0,
            cacheRead: m.usage.cacheRead || 0,
            cacheWrite: m.usage.cacheWrite || 0,
            cost: m.usage.cost?.total || 0,
            kind: "session",
          });
        }
      } catch { /* partial line while writing; ignore */ }
    }
  } catch { /* ignore */ }
  filePos.set(sessionFile, size);
  return rows;
}

/** Impact totals for THIS session: ledger rows (main calls) + sqlite rows
 *  (nested subagent calls), both scoped to (cwd, sessionId). */
function sessionTotals(cwd: string, sessionId: string): { kwh: number; kgCO2e: number; waterL: number; cost: number } {
  let rows = core.readLedger().filter((r: any) => r.kind !== "subagent" && r.cwd === cwd && r.sessionId === sessionId);
  let sub: any[] = [];
  try {
    sub = core.scanSubagents().filter((r: any) => r.cwd === cwd && r.sessionId === sessionId);
  } catch { /* sqlite may not exist yet */ }
  rows = [...rows, ...sub];
  const t = core.sumImpact(rows);
  return { kwh: t.kwh, kgCO2e: t.kgCO2e, waterL: t.waterL, cost: t.cost };
}

function fmt(v: number): string {
  if (v >= 1) return v.toFixed(1);
  if (v >= 0.01) return v.toFixed(2);
  return "<0.01";
}

export default async function impactCostExtension(pi: ExtensionAPI): Promise<void> {
  let cwd = "";
  let sessionId = "";
  let sessionFile = "";
  let pending = false;

  function render(ctx: any) {
    const t = sessionTotals(cwd, sessionId);
    const theme = ctx.ui.theme;
    if (t.cost === 0 && t.kwh === 0) {
      ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "◆ impact: none yet"));
      return;
    }
    const parts = [
      theme.fg("dim", "◆ impact: "),
      theme.fg("accent", `${fmt(t.kwh)} kWh`),
      theme.fg("text", `· ${fmt(t.kgCO2e)} kgCO2e`),
      theme.fg("muted", `· ${fmt(t.waterL)} L`),
    ];
    ctx.ui.setStatus(STATUS_KEY, parts.join(" "));
  }

  function requestRender(ctx: any) {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; render(ctx); }, 200);
  }

  pi.on("session_start", (_e: any, ctx: any) => {
    sessionFile = sessionFileOf(ctx);
    sessionId = sessionIdOf(ctx);
    cwd = ctx?.cwd ?? process.cwd();
    filePos.delete(sessionFile);
    setTimeout(() => render(ctx), 100);
  });

  pi.on("message_end", (_e: any, ctx: any) => {
    if (!ctx?.hasUI) return;
    const sf = sessionFileOf(ctx);
    const sid = sessionIdOf(ctx);
    const rows = newSessionRows(sf, sid, cwd);
    try { core.appendLedger(rows); } catch { /* ledger write must never break the session */ }
    requestRender(ctx);
  });
}