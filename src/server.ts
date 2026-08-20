#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerInspectLayout } from "./tools/inspect-layout.js";
import { registerInspectElement } from "./tools/inspect-element.js";
import { registerFindIssues } from "./tools/find-issues.js";
import { registerTraceProperty } from "./tools/trace-property.js";
import { registerCompareElements } from "./tools/compare-elements.js";
import { registerGetScrollTree } from "./tools/get-scroll-tree.js";
import { registerQueryLayout } from "./tools/query-layout.js";
import { registerCapturePage } from "./tools/capture-page.js";
import { registerDetectShifts } from "./tools/detect-shifts.js";
import { registerCheckAnimations } from "./tools/check-animations.js";
import { registerCompareColorSchemes } from "./tools/compare-color-schemes.js";
import { registerCheckInteractiveStates } from "./tools/check-interactive-states.js";
import { registerWatchDomMutations } from "./tools/watch-dom-mutations.js";
import { registerProfileRendering } from "./tools/profile-rendering.js";
import { registerTestResponsive } from "./tools/test-responsive.js";

const server = new McpServer({
  name: "layout-lens",
  version: "0.1.0",
});

registerInspectLayout(server);
registerInspectElement(server);
registerFindIssues(server);
registerTraceProperty(server);
registerCompareElements(server);
registerGetScrollTree(server);
registerQueryLayout(server);
registerCapturePage(server);
registerDetectShifts(server);
registerCheckAnimations(server);
registerCompareColorSchemes(server);
registerCheckInteractiveStates(server);
registerWatchDomMutations(server);
registerProfileRendering(server);
registerTestResponsive(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
