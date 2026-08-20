import { CDPConnection } from '../src/cdp/connection.js';
import { LayoutExtractor } from '../src/cdp/extractor.js';
import { OverflowDetector } from '../src/detectors/overflow.js';
import { StackingDetector } from '../src/detectors/stacking.js';
import { VisibilityDetector } from '../src/detectors/visibility.js';
import { FlexGridDetector } from '../src/detectors/flex-grid.js';
import { ScrollDetector } from '../src/detectors/scroll.js';
import { MarginCollapseDetector } from '../src/detectors/margin-collapse.js';
import { TextTruncationDetector } from '../src/detectors/text-truncation.js';
import { ImageDistortionDetector } from '../src/detectors/image-distortion.js';
import { WhitespaceDetector } from '../src/detectors/whitespace.js';
import { FixedCollisionDetector } from '../src/detectors/fixed-collision.js';
import { formatLayoutOverview, formatIssues } from '../src/formatter/text.js';
import type { Detector } from '../src/types.js';

async function main() {
  console.log('=== Layout Lens E2E Test ===\n');

  console.log('1. Connecting to Chrome...');
  const connection = await CDPConnection.connect({ port: 9222 });
  console.log('   Connected!\n');

  console.log('2. Extracting layout tree...');
  const extractor = new LayoutExtractor(connection);
  const tree = await extractor.extractTree();
  console.log(`   Extracted! Root: <${tree.root.tag}>, viewport: ${tree.viewport.width}x${tree.viewport.height}\n`);

  console.log('3. Running all 10 detectors...');
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

  const allIssues = detectors.flatMap(d => {
    const issues = d.detect(tree);
    if (issues.length > 0) {
      console.log(`   ${d.category}: ${issues.length} issue(s)`);
    }
    return issues;
  });
  console.log(`   Total: ${allIssues.length} issues found\n`);

  console.log('4. Formatted overview:\n');
  console.log(formatLayoutOverview(tree, allIssues));

  console.log('\n5. All issues with diagnostics:\n');
  console.log(formatIssues(allIssues));

  await connection.disconnect();
  console.log('\n=== Done ===');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
