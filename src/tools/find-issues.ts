import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { Detector, Issue } from "../types.js";
import { OverflowDetector } from "../detectors/overflow.js";
import { StackingDetector } from "../detectors/stacking.js";
import { VisibilityDetector } from "../detectors/visibility.js";
import { FlexGridDetector } from "../detectors/flex-grid.js";
import { ScrollDetector } from "../detectors/scroll.js";
import { MarginCollapseDetector } from "../detectors/margin-collapse.js";
import { TextTruncationDetector } from "../detectors/text-truncation.js";
import { ImageDistortionDetector } from "../detectors/image-distortion.js";
import { WhitespaceDetector } from "../detectors/whitespace.js";
import { FixedCollisionDetector } from "../detectors/fixed-collision.js";
import { formatIssues } from "../formatter/text.js";

function allDetectors(): Detector[] {
  return [
    new OverflowDetector(),
    new StackingDetector(),
    new VisibilityDetector(),
    new FlexGridDetector(),
    new ScrollDetector(),
    new MarginCollapseDetector(),
    new TextTruncationDetector(),
    new ImageDistortionDetector(),
    new WhitespaceDetector(),
    new FixedCollisionDetector(),
  ];
}

export function registerFindIssues(server: McpServer): void {
  server.tool(
    "find_issues",
    "Detect layout issues on the page. Optionally filter by category: overflow, stacking, visibility, flex-grid, scroll, margin-collapse, text-truncation, image-distortion, whitespace, fixed-collision.",
    {
      category: z.enum([
        "overflow",
        "stacking",
        "visibility",
        "flex-grid",
        "scroll",
        "margin-collapse",
        "text-truncation",
        "image-distortion",
        "whitespace",
        "fixed-collision",
      ]).optional().describe("Filter issues by category. Omit to detect all."),
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

        const extractor = new LayoutExtractor(connection);
        const tree = await extractor.extractTree();

        let detectors = allDetectors();
        if (params.category) {
          detectors = detectors.filter((d) => d.category === params.category);
        }

        const issues: Issue[] = [];
        for (const detector of detectors) {
          issues.push(...detector.detect(tree));
        }

        const text = formatIssues(issues);

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
