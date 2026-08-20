import { CDPConnection } from "../../src/cdp/connection.js";
import { LayoutExtractor } from "../../src/cdp/extractor.js";
import { OverflowDetector } from "../../src/detectors/overflow.js";
import { StackingDetector } from "../../src/detectors/stacking.js";
import { VisibilityDetector } from "../../src/detectors/visibility.js";
import { FlexGridDetector } from "../../src/detectors/flex-grid.js";
import { ScrollDetector } from "../../src/detectors/scroll.js";
import { MarginCollapseDetector } from "../../src/detectors/margin-collapse.js";
import { TextTruncationDetector } from "../../src/detectors/text-truncation.js";
import { ImageDistortionDetector } from "../../src/detectors/image-distortion.js";
import { WhitespaceDetector } from "../../src/detectors/whitespace.js";
import { FixedCollisionDetector } from "../../src/detectors/fixed-collision.js";
import { formatLayoutOverview } from "../../src/formatter/text.js";
import type { Detector, Issue } from "../../src/types.js";
import { readFileSync } from "fs";
import { resolve } from "path";

interface ExpectedBug {
  id: string;
  description: string;
  fix: string;
}

interface BenchmarkPage {
  page: string;
  prompt: string;
  expected_bugs: ExpectedBug[];
}

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

async function runBenchmark() {
  const promptsPath = resolve(import.meta.dirname!, "prompts.json");
  const pages: BenchmarkPage[] = JSON.parse(readFileSync(promptsPath, "utf-8"));

  const connection = await CDPConnection.connect({ port: 9222 });
  const client = connection.client;

  console.log("=== LAYOUT LENS BENCHMARK ===\n");

  for (const page of pages) {
    const filePath = resolve(import.meta.dirname!, page.page);
    const fileUrl = `file:///${filePath.replace(/\\/g, "/")}`;

    // Navigate to the page
    await client.Page.enable();
    await client.Page.navigate({ url: fileUrl });
    await client.Page.loadEventFired();
    // Small delay for rendering
    await new Promise(r => setTimeout(r, 500));

    console.log(`\n${"=".repeat(60)}`);
    console.log(`PAGE: ${page.page}`);
    console.log(`PROMPT: "${page.prompt.slice(0, 80)}..."`);
    console.log(`EXPECTED BUGS: ${page.expected_bugs.length}`);
    console.log(`${"=".repeat(60)}`);

    // Extract with lightweight mode
    const t0 = Date.now();
    const extractor = new LayoutExtractor(connection);
    const tree = await extractor.extractTree({ lightweight: true });
    const extractTime = Date.now() - t0;

    // Run detectors
    const detectors = allDetectors();
    const issues: Issue[] = [];
    for (const detector of detectors) {
      issues.push(...detector.detect(tree));
    }

    console.log(`\nExtraction: ${extractTime}ms`);
    console.log(`Issues found: ${issues.length}`);

    // Check which expected bugs are covered
    const overview = formatLayoutOverview(tree, issues);
    const overviewLower = overview.toLowerCase();

    console.log(`\n--- BUG DETECTION RESULTS ---`);
    let found = 0;
    for (const bug of page.expected_bugs) {
      const detected = checkBugDetected(bug, issues, overviewLower);
      const status = detected ? "✓ DETECTED" : "✗ MISSED";
      console.log(`  ${status}: ${bug.id} — ${bug.description.slice(0, 70)}...`);
      if (detected) found++;
    }

    console.log(`\nScore: ${found}/${page.expected_bugs.length} bugs detected`);

    // Show all issues for context
    console.log(`\n--- ALL ISSUES DETECTED ---`);
    for (const issue of issues) {
      console.log(`  [${issue.severity}] ${issue.category}: ${issue.summary.slice(0, 100)}`);
    }
  }

  await connection.disconnect();
}

function checkBugDetected(bug: ExpectedBug, issues: Issue[], overviewLower: string): boolean {
  switch (bug.id) {
    case "hero-stretch":
    case "product-image-distortion":
    case "article-image-distortion":
    case "related-images-distortion":
      return issues.some(i => i.category === "image-distortion");

    case "product-name-truncation":
      return issues.some(i => i.category === "text-truncation");

    case "reviews-clipped":
    case "table-clipped":
    case "code-block-clipped":
      return issues.some(i =>
        i.category === "overflow" &&
        (i.summary ?? "").toLowerCase().includes("hidden")
      ) || issues.some(i =>
        i.category === "scroll" &&
        (i.summary ?? "").toLowerCase().includes("hidden")
      );

    case "notification-stacking":
    case "notification-panel-z":
    case "cookie-banner-z-index":
      return issues.some(i => i.category === "stacking");

    case "sticky-thead-broken":
      return issues.some(i =>
        i.category === "scroll" &&
        (i.summary ?? "").toLowerCase().includes("sticky")
      );

    case "main-content-overlap":
      return issues.some(i =>
        i.category === "fixed-collision" ||
        (i.category === "overflow" && overviewLower.includes("notification"))
      );

    case "toc-overlap":
    case "share-bar-overlap":
      return issues.some(i =>
        i.category === "fixed-collision" ||
        i.category === "overflow"
      );

    default:
      return false;
  }
}

runBenchmark().catch(console.error);
