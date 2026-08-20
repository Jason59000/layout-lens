import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { Detector, Issue, LayoutNode, LayoutTree } from "../types.js";
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
import { formatElement } from "../formatter/text.js";
import { walkTree } from "../detectors/types.js";

/**
 * Find a node in the tree by matching its selector path.
 * Matches against tag, id, classes.
 */
function findNodeBySelector(
  tree: LayoutTree,
  selector: string,
): LayoutNode | undefined {
  const selectorLower = selector.toLowerCase();
  let match: LayoutNode | undefined;

  walkTree(tree, (node) => {
    if (match) return; // already found

    // Match by id
    if (selector.startsWith("#") && node.id === selector.slice(1)) {
      match = node;
      return;
    }

    // Match by class
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      if (node.classes.includes(className)) {
        match = node;
        return;
      }
    }

    // Match full selector (tag.class or tag#id)
    const nodeSelector = buildMatchSelector(node);
    if (nodeSelector.toLowerCase() === selectorLower) {
      match = node;
      return;
    }

    // Match the node's own selector property
    if (node.selector.toLowerCase() === selectorLower) {
      match = node;
      return;
    }
  });

  return match;
}

function buildMatchSelector(node: LayoutNode): string {
  let sel = node.tag;
  if (node.id) sel += `#${node.id}`;
  if (node.classes.length > 0) sel += node.classes.map((c) => `.${c}`).join("");
  return sel;
}

export function registerInspectElement(server: McpServer): void {
  server.tool(
    "inspect_element",
    "Inspect a specific element by CSS selector. Returns detailed box model, computed styles, parent relationship, stacking context, and any detected issues.",
    {
      selector: z.string().describe("CSS selector to find the element (e.g. '#my-id', '.my-class', 'div.container')"),
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

        const node = findNodeBySelector(tree, params.selector);
        if (!node) {
          return {
            content: [{ type: "text", text: `Element not found: "${params.selector}". Try a different selector.` }],
            isError: true,
          };
        }

        // Run all detectors to find issues related to this element
        const detectors: Detector[] = [
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

        const issues: Issue[] = [];
        for (const detector of detectors) {
          issues.push(...detector.detect(tree));
        }

        const text = formatElement(node, tree, issues);

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
