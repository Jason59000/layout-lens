import { CDPConnection } from '../src/cdp/connection.js';
import { LayoutExtractor } from '../src/cdp/extractor.js';

async function main() {
  const conn = await CDPConnection.connect({ port: 9222 });
  const ext = new LayoutExtractor(conn);
  const tree = await ext.extractTree();

  console.log('Root tag:', tree.root.tag);
  console.log('Root children:', tree.root.children.length);

  function walk(n: any, depth: number) {
    if (depth < 3) {
      const cls = n.classes?.length ? '.' + n.classes[0] : '';
      console.log('  '.repeat(depth) + n.tag + cls, 'rules:', n.rules.length, 'mb:', n.boxModel.margin.bottom, 'mt:', n.boxModel.margin.top);
    }
    for (const c of n.children) walk(c, depth + 1);
  }
  walk(tree.root, 0);

  console.log('\n--- Checking margin-box-a ---');
  function find(n: any, cls: string): any {
    if (n.classes?.includes(cls)) return n;
    for (const c of n.children) {
      const r = find(c, cls);
      if (r) return r;
    }
    return null;
  }

  const mba = find(tree.root, 'margin-box-a');
  if (mba) {
    console.log('margin-box-a found:', mba.selector);
    console.log('  margin-bottom:', mba.boxModel.margin.bottom);
    console.log('  rules:', mba.rules.length);
    const marginRules = mba.rules.filter((r: any) => r.property.includes('margin'));
    console.log('  margin rules:', marginRules.length);
    marginRules.forEach((r: any) => console.log('   ', r.property, '=', r.value, 'ua:', r.isUserAgent));
  } else {
    console.log('margin-box-a NOT FOUND');
  }

  await conn.disconnect();
}

main().catch(e => console.error('ERROR:', e));
