import { CDPConnection } from "../src/cdp/connection.js";
import { LayoutExtractor } from "../src/cdp/extractor.js";

async function main() {
  const connection = await CDPConnection.connect({ port: 9222 });
  const extractor = new LayoutExtractor(connection);

  // Count elements
  const countResult = await connection.client.Runtime.evaluate({
    expression: "document.querySelectorAll('*').length",
    returnByValue: true,
  });
  const elementCount = countResult.result.value;
  console.log(`Page has ${elementCount} elements`);

  console.log("\n--- LIGHTWEIGHT MODE ---");
  const t1 = Date.now();
  const tree = await extractor.extractTree({ lightweight: true });
  const elapsed = Date.now() - t1;

  function countNodes(node: any): number {
    return 1 + (node.children || []).reduce((sum: number, c: any) => sum + countNodes(c), 0);
  }

  const nodeCount = countNodes(tree.root);
  console.log(`Time: ${elapsed}ms`);
  console.log(`Nodes extracted: ${nodeCount}`);
  console.log(`Rules on root: ${tree.root.rules.length} (should be 0)`);
  console.log(`Viewport: ${tree.viewport.width}x${tree.viewport.height}`);
  console.log(`Speed: ${Math.round(nodeCount / (elapsed / 1000))} nodes/sec`);

  await connection.disconnect();
}

main().catch(console.error);
