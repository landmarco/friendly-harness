#!/usr/bin/env node
/**
 * Impact dashboard server - serves the d3 report on localhost and persists
 * assumption edits back to impact/config.json.
 *
 * GET  /                 report.html
 * GET  /vendor/d3.min.js vendored d3 (no CDN dependency)
 * GET  /api/data         full dataset + totals (engine computed)
 * GET  /api/health       liveness probe
 * PUT  /api/config       save config overrides (persists to config.json)
 * PUT  /api/config/reset restore built-in defaults
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "./impact-core.mjs";

const IMPACT_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FPI_IMPACT_PORT || 8731);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

const dayOf = (r) => String(r.ts || "").slice(0, 10);

/** Earliest and latest day (YYYY-MM-DD) present in the rows. */
function dataRange(rows) {
  const days = rows
    .map(dayOf)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return days.length ? { min: days[0], max: days[days.length - 1] } : { min: null, max: null };
}

/** Keep only rows whose day falls in [from, to] (inclusive, both optional). */
function withinRange(rows, from, to) {
  if (!from && !to) return rows;
  return rows.filter((r) => {
    const d = dayOf(r);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function computeTotals(rows, config) {
  const totals = core.sumImpact(rows, config);
  return {
    ...totals,
    games: core.gameHours(totals.kwh, config),
    byDay: core.byDay(rows, config),
    byModel: core.byModel(rows, config),
    byProject: core.byProject(rows, config),
    byModelProject: core.byModelProject(rows, config),
    equivalents: core.equivalentsFor(
      totals.kwh,
      totals.kgCO2e,
      totals.waterL,
      core.gameHours(totals.kwh, config),
    ),
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    const html = readFileSync(join(IMPACT_DIR, "report.html"), "utf8");
    return send(res, 200, html, MIME[".html"]);
  }
  if (req.method === "GET" && path.startsWith("/vendor/")) {
    const file = join(IMPACT_DIR, "vendor", path.slice("/vendor/".length));
    const base = file.replace(/^.*\.(\w+)$/, "$1");
    if (!existsSync(file) || file.includes("..")) return send(res, 404, "not found");
    return send(res, 200, readFileSync(file), MIME["." + base] || "application/octet-stream");
  }
  if (req.method === "GET" && path === "/api/data") {
    try {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const { sessionRows, subagentRows } = core.allRows();
      const all = [...sessionRows, ...subagentRows];
      const config = core.loadConfig();
      return send(res, 200, JSON.stringify({
        generated: new Date().toISOString(),
        config,
        defaults: core.loadDefaults(),
        states: core.loadStates(),
        profiles: core.loadProfiles(),
        rows: withinRange(all, from, to),
        range: dataRange(all),
        totals: computeTotals(withinRange(all, from, to), config),
        assumptions: core.assumptionsList(),
      }), MIME[".json"]);
    } catch (err) { return send(res, 500, JSON.stringify({ error: String(err) }), MIME[".json"]); }
  }
  if (req.method === "GET" && path === "/api/health") {
    return send(res, 200, "ok");
  }
  if (req.method === "POST" && path === "/api/compute") {
    const body = await readBody(req);
    try {
      const { sessionRows, subagentRows } = core.allRows();
      const all = withinRange(
        [...sessionRows, ...subagentRows],
        body.from,
        body.to
      );
      const config = { ...core.loadConfig(), ...(body.config || {}) };
      return send(res, 200, JSON.stringify({ totals: computeTotals(all, config) }), MIME[".json"]);
    } catch (err) {
      return send(res, 500, JSON.stringify({ error: String(err) }), MIME[".json"]);
    }
  }
  if (req.method === "PUT" && path === "/api/config") {
    const body = await readBody(req);
    try {
      if (body.reset) {
        // Revert assumption values to defaults, but keep the user's location -
        // it is a fact about the user, not an assumption to reset.
        const current = core.loadConfig();
        const defaults = core.loadDefaults();
        core.saveConfig({ ...defaults, location: current.location || defaults.location });
      } else {
        const current = core.loadConfig();
        core.saveConfig({ ...current, ...(body.config || {}) });
      }
      return send(res, 200, JSON.stringify({ ok: true, config: core.loadConfig() }), MIME[".json"]);
    } catch (err) {
      return send(res, 500, JSON.stringify({ error: String(err) }), MIME[".json"]);
    }
  }
  return send(res, 404, "not found");
}).listen(PORT, "127.0.0.1", () => {
  console.log(`fpi-impact serving on http://127.0.0.1:${PORT}`);
});