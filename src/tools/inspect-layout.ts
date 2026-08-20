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
import { formatLayoutOverview } from "../formatter/text.js";

/**
 * All available layout detectors.
 */
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

export function registerInspectLayout(server: McpServer): void {
  server.tool(
    "inspect_layout",
    "Capture the full page layout tree and detect all layout anomalies. Returns a tree overview with overflow, stacking, visibility, and other CSS issues flagged.",
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

        const extractor = new LayoutExtractor(connection);
        const tree = await extractor.extractTree({ lightweight: true });

        const detectors = allDetectors();
        const issues: Issue[] = [];
        for (const detector of detectors) {
          issues.push(...detector.detect(tree));
        }

        const text = formatLayoutOverview(tree, issues);

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
