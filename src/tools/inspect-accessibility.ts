import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

interface AXNode {
  nodeId: string;
  role: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  properties?: Array<{ name: string; value: { value: any } }>;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
}

function formatAXTree(
  nodes: AXNode[],
  nodeMap: Map<string, AXNode>,
  nodeId: string,
  prefix: string,
  isLast: boolean,
  depth: number,
  maxDepth: number,
  lines: string[],
): void {
  const node = nodeMap.get(nodeId);
  if (!node) return;
  if (node.ignored) return;

  const role = node.role?.value ?? "unknown";
  if (role === "none" || role === "generic") {
    const kids = node.childIds ?? [];
    for (let i = 0; i < kids.length; i++) {
      formatAXTree(nodes, nodeMap, kids[i], prefix, i === kids.length - 1, depth, maxDepth, lines);
    }
    return;
  }

  const connector = depth === 0 ? "" : isLast ? "└── " : "├── ";
  const name = node.name?.value ?? "";
  const value = node.value?.value ?? "";

  let label = `[${role}]`;
  if (name) label += ` "${name}"`;
  if (value) label += ` = "${value}"`;

  const props: string[] = [];
  if (node.properties) {
    for (const p of node.properties) {
      const v = p.value?.value;
      if (v === undefined || v === false || v === "false" || v === "") continue;
      if (p.name === "focusable" && v === true) props.push("focusable");
      else if (p.name === "focused" && v === true) props.push("FOCUSED");
      else if (p.name === "disabled" && v === true) props.push("disabled");
      else if (p.name === "hidden" && v === true) props.push("hidden");
      else if (p.name === "required" && v === true) props.push("required");
      else if (p.name === "invalid" && v !== "false") props.push(`invalid: ${v}`);
      else if (p.name === "checked") props.push(`checked: ${v}`);
      else if (p.name === "expanded") props.push(`expanded: ${v}`);
      else if (p.name === "selected" && v === true) props.push("selected");
      else if (p.name === "level") props.push(`level: ${v}`);
      else if (p.name === "live") props.push(`live: ${v}`);
    }
  }
  if (props.length > 0) label += ` (${props.join(", ")})`;

  lines.push(prefix + connector + label);

  if (depth >= maxDepth) {
    const kids = node.childIds ?? [];
    if (kids.length > 0) {
      const childPrefix = prefix + (depth === 0 ? "" : isLast ? "    " : "│   ");
      lines.push(childPrefix + "└── ... (" + kids.length + " children)");
    }
    return;
  }

  const kids = node.childIds ?? [];
  const childPrefix = prefix + (depth === 0 ? "" : isLast ? "    " : "│   ");
  for (let i = 0; i < kids.length; i++) {
    formatAXTree(nodes, nodeMap, kids[i], childPrefix, i === kids.length - 1, depth + 1, maxDepth, lines);
  }
}

export function registerInspectAccessibility(server: McpServer): void {
  server.tool(
    "inspect_accessibility",
    "Get the full accessibility tree as a screen reader sees it. Shows roles, names, states (focused, disabled, expanded, checked), and hierarchy. Use to verify ARIA, find missing labels, or check focus order.",
    {
      maxDepth: z.number().optional().describe("Max tree depth (default: 8)"),
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
        await (client as any).Accessibility.enable();
        const result = await (client as any).Accessibility.getFullAXTree();
        const nodes: AXNode[] = result.nodes;

        const nodeMap = new Map<string, AXNode>();
        for (const n of nodes) {
          nodeMap.set(n.nodeId, n);
        }

        const rootNode = nodes[0];
        if (!rootNode) {
          return {
            content: [{ type: "text", text: "No accessibility tree found." }],
          };
        }

        const lines: string[] = [];
        lines.push("ACCESSIBILITY TREE");
        lines.push(`${nodes.length} nodes total`);
        lines.push("");

        const maxDepth = params.maxDepth ?? 8;
        formatAXTree(nodes, nodeMap, rootNode.nodeId, "", true, 0, maxDepth, lines);

        const focusable = nodes.filter(n =>
          n.properties?.some(p => p.name === "focusable" && p.value?.value === true)
        );
        const focused = nodes.filter(n =>
          n.properties?.some(p => p.name === "focused" && p.value?.value === true)
        );

        lines.push("");
        lines.push(`SUMMARY: ${focusable.length} focusable elements, ${focused.length} currently focused`);

        const missingNames = nodes.filter(n => {
          if (n.ignored) return false;
          const role = n.role?.value;
          if (!role || role === "none" || role === "generic" || role === "group" || role === "div") return false;
          const interactive = ["button", "link", "textbox", "checkbox", "radio", "combobox", "menuitem", "tab", "switch"];
          if (!interactive.includes(role)) return false;
          return !n.name?.value;
        });

        if (missingNames.length > 0) {
          lines.push(`WARNING: ${missingNames.length} interactive element(s) missing accessible name:`);
          for (const n of missingNames.slice(0, 10)) {
            lines.push(`  [${n.role.value}] (backendNodeId: ${n.backendDOMNodeId ?? "?"})`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
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
