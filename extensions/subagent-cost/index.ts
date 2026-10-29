/**
 * Subagent Cost - per-session subagent spend in the footer, split by billing
 * source.
 *
 * Why: subagent runs are separate nested pi sessions, so their usage never
 * lands in the parent session's $ meter in the footer. This extension reads
 * the pi-subagents history sqlite (scoped to THIS parent session + cwd) and
 * shows a running total alongside the rewind-hook snapshot line:
 *
 *   ◆ subagents: $0.01 | 281k codex
 *
 * Billing split:
 *   - openai-codex/*  => OpenAI subscription (ChatGPT Plus/Pro). Not metered
 *     in dollars; we report input+output tokens.
 *   - everything else  => metered spend in dollars (e.g. openrouter/*).
 *
 * Scoping: totals come only from rows matching this session's (cwd, session_id),
 * so concurrent sessions (friendly-harness vs another project) show only their own
 * subagent spend.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Mirror pi-subagents' history path resolution (env overrides, then default).
function historyDbPath(): string {
  const env = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  if (env) return env;
  const home = process.env.PI_SUBAGENTS_HISTORY_HOME ?? process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(home, "pi", "subagents", "subagents-history.sqlite");
}

const HISTORY_DB = historyDbPath();
const STATUS_KEY = "subagent-cost";
const CODEX_PROVIDER = "openai-codex";

type TaskRow = { model: string; usage_input: number; usage_output: number; usage_cost: number };

/** Full session id. Mirrors pi-subagents' currentSessionId() (incl. the
 * getSessionFile() fallback used when getSessionId() is unavailable). */
function sessionIdOf(ctx: any): string {
  const direct = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const file = ctx?.sessionManager?.getSessionFile?.();
  return typeof file === "string" && file.length > 0 ? file : "";
}

function codexTokenTotal(t: TaskRow): number {
  return (t.usage_input || 0) + (t.usage_output || 0);
}

/** Read subagent_tasks scoped to this session (cwd + session_id), split by
 *  billing source:
 *  - openai-codex/*      => subscription tokens (never metered in $).
 *  - anything with cost  => metered dollars (e.g. openrouter/*). */
function readSessionTotals(cwd: string, sessionId: string): { meteredCost: number; codexTokens: number } {
  const out = { meteredCost: 0, codexTokens: 0 };
  if (!sessionId || !existsSync(HISTORY_DB)) return out;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(HISTORY_DB, { readOnly: true });
    const stmt = db.prepare(
      `SELECT model, usage_input, usage_output, usage_cost
       FROM subagent_tasks WHERE session_id = ? AND cwd = ?`
    );
    for (const r of stmt.all(sessionId, cwd) as TaskRow[]) {
      if ((r.model || "").startsWith(CODEX_PROVIDER + "/")) {
        out.codexTokens += codexTokenTotal(r);
      } else {
        out.meteredCost += r.usage_cost || 0;
      }
    }
  } catch (err) {
    console.error("[subagent-cost] sqlite read failed:", err);
  } finally {
    db?.close();
  }
  return out;
}

function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

export default function subagentCostExtension(pi: ExtensionAPI): void {
  let sessionId = "";
  let cwd = "";
  let pendingRender = false;

  function render(ctx: any) {
    const totals = readSessionTotals(cwd, sessionId);
    const theme = ctx.ui.theme;
    const parts: string[] = [theme.fg("dim", "◆ "), "subagents: "];
    if (totals.meteredCost > 0 || totals.codexTokens > 0) {
      const groups: string[] = [];
      if (totals.meteredCost > 0) {
        groups.push(theme.fg("accent", `$${totals.meteredCost.toFixed(2)}`));
      }
      if (totals.codexTokens > 0) {
        groups.push(theme.fg("text", `${formatTokens(totals.codexTokens)} codex`));
      }
      parts.push(groups.join(theme.fg("muted", " | ")));
    } else {
      parts.push(theme.fg("muted", "no subagent spend"));
    }
    ctx.ui.setStatus(STATUS_KEY, parts.join(""));
  }

  // Throttle renders to ~1/s but always flush a pending one on the next
  // event, so no relevant update (e.g. a subagent-completion) is dropped.
  function requestRender(ctx: any) {
    if (pendingRender) return;
    pendingRender = true;
    setTimeout(() => {
      pendingRender = false;
      render(ctx);
    }, 200);
  }

  pi.on("session_start", (_e: any, ctx: any) => {
    sessionId = sessionIdOf(ctx);
    cwd = ctx?.cwd ?? process.cwd();
    // de-dup the startup + first requestRender back-to-back
    pendingRender = false;
    setTimeout(() => render(ctx), 100);
  });

  pi.on("message_end", (_e: any, ctx: any) => {
    if (!ctx?.hasUI) return;
    requestRender(ctx);
  });
}