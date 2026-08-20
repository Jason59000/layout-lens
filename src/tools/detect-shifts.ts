import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

interface ShiftSource {
  node: string | null;
  prev: { x: number; y: number; w: number; h: number };
  curr: { x: number; y: number; w: number; h: number };
}

interface ShiftEntry {
  score: number;
  ts: number;
  hadRecentInput: boolean;
  sources: ShiftSource[];
}

function describeMovement(prev: ShiftSource["prev"], curr: ShiftSource["curr"]): string {
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dw = curr.w - prev.w;
  const dh = curr.h - prev.h;
  const parts: string[] = [];
  if (dy > 0) parts.push(`${dy}px downward`);
  else if (dy < 0) parts.push(`${Math.abs(dy)}px upward`);
  if (dx > 0) parts.push(`${dx}px rightward`);
  else if (dx < 0) parts.push(`${Math.abs(dx)}px leftward`);
  if (dw !== 0) parts.push(`width ${dw > 0 ? "+" : ""}${dw}px`);
  if (dh !== 0) parts.push(`height ${dh > 0 ? "+" : ""}${dh}px`);
  return parts.length > 0 ? parts.join(", ") : "no visible movement";
}

function formatRect(r: { x: number; y: number; w: number; h: number }): string {
  return `(${r.x},${r.y},${r.w},${r.h})`;
}

function formatShifts(entries: ShiftEntry[]): string {
  if (entries.length === 0) {
    return "NO LAYOUT SHIFTS DETECTED\n\nCLS score: 0 — page is stable.";
  }

  const clsScore = entries
    .filter(e => !e.hadRecentInput)
    .reduce((sum, e) => sum + e.score, 0);

  const lines: string[] = [];
  lines.push(`LAYOUT SHIFTS DETECTED (CLS: ${clsScore.toFixed(4)})`);
  lines.push("");

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const inputTag = e.hadRecentInput ? ", user-input-related" : "";
    lines.push(`SHIFT #${i + 1} (score: ${e.score.toFixed(4)}, at ${Math.round(e.ts)}ms${inputTag})`);

    if (e.sources.length === 0) {
      lines.push("  sources: none reported");
    }

    for (const s of e.sources) {
      lines.push(`  element: ${s.node ?? "(unknown)"}`);
      lines.push(`  moved: from ${formatRect(s.prev)} → ${formatRect(s.curr)}`);
      lines.push(`  shift: ${describeMovement(s.prev, s.curr)}`);
    }

    lines.push("");
  }

  if (clsScore <= 0.1) {
    lines.push("VERDICT: CLS is good (≤ 0.1)");
  } else if (clsScore <= 0.25) {
    lines.push("VERDICT: CLS needs improvement (0.1 – 0.25)");
  } else {
    lines.push("VERDICT: CLS is poor (> 0.25)");
  }

  return lines.join("\n");
}

export function registerDetectShifts(server: McpServer): void {
  server.tool(
    "detect_layout_shifts",
    `Detect Cumulative Layout Shift (CLS) events on the page. Reports every layout-shift entry from the Performance API, with source elements, before/after rects, and total CLS score.

Use after page load to diagnose unexpected content movement — images without dimensions, injected ads, late-loading fonts, or dynamic content pushing elements around.`,
    {
      port: z.number().optional().describe("Chrome debugging port (default: 9222)"),
      host: z.string().optional().describe("Chrome debugging host (default: localhost)"),
    },
    async (params) => {
      let connection: CDPConnection | undefined;
      try {
        connection = await CDPConnection.connect({
          host: params.host,
          port: params.port,
        });
        const client = connection.client;

        const result = await client.Runtime.evaluate({
          expression: `JSON.stringify(performance.getEntriesByType('layout-shift').map(e => ({
  score: e.value,
  ts: e.startTime,
  hadRecentInput: e.hadRecentInput,
  sources: e.sources ? e.sources.map(s => ({
    node: s.node ? s.node.nodeName : null,
    prev: { x: s.previousRect.x, y: s.previousRect.y, w: s.previousRect.width, h: s.previousRect.height },
    curr: { x: s.currentRect.x, y: s.currentRect.y, w: s.currentRect.width, h: s.currentRect.height }
  })) : []
})))`,
          returnByValue: true,
        });

        const raw = result.result.value as string;
        const entries: ShiftEntry[] = JSON.parse(raw);
        const text = formatShifts(entries);

        return {
          content: [{ type: "text", text }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `ERROR: ${message}` }],
          isError: true,
        };
      } finally {
        if (connection) {
          await connection.disconnect();
        }
      }
    },
  );
}
