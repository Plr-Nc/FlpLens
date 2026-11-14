#!/usr/bin/env node
/**
 * Inlines the built JS + CSS into a single HTML file.
 *
 * Reason: `file://` blocks external module requests (CORS), so a normal Vite
 * build cannot be opened by double-clicking. An inlined module script is not a
 * request, so it runs. Result: dist/flplens.html works offline, anywhere.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) {
  console.error('dist/index.html not found — run `npm run build` first');
  process.exit(1);
}

let html = readFileSync(indexPath, 'utf8');
let inlinedCss = 0;
let inlinedJs = 0;

html = html.replace(
  /<link[^>]*rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+)"[^>]*>/g,
  (_match, href) => {
    inlinedCss++;
    return `<style>\n${readFileSync(join(dist, href), 'utf8')}\n</style>`;
  },
);

html = html.replace(
  /<script[^>]*type="module"[^>]*src="\.?\/?(assets\/[^"]+)"[^>]*><\/script>/g,
  (_match, src) => {
    inlinedJs++;
    // A literal </script> inside the bundle would close the tag early.
    const js = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
    return `<script type="module">\n${js}\n</script>`;
  },
);

const out = join(dist, 'flplens.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB, ${inlinedJs} script, ${inlinedCss} style)`);
