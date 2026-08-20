#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerInspectLayout } from "./tools/inspect-layout.js";
import { registerInspectElement } from "./tools/inspect-element.js";
import { registerFindIssues } from "./tools/find-issues.js";
import { registerTraceProperty } from "./tools/trace-property.js";
import { registerCompareElements } from "./tools/compare-elements.js";
import { registerGetScrollTree } from "./tools/get-scroll-tree.js";

const server = new McpServer({
  name: "layout-lens",
  version: "0.1.0",
});

// Register all 6 layout analysis tools
registerInspectLayout(server);
registerInspectElement(server);
registerFindIssues(server);
registerTraceProperty(server);
registerCompareElements(server);
registerGetScrollTree(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
