import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkSite, collectSiteFiles } from './check-site.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'portfolio-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

test('valid local URLs, fragments, inline modules and data blocks need no network', async t => {
  const root = await fixture(t, {
    'index.html': `<!-- <img src="missing-comment.png"> -->
      <a id="入口" href="resume/?v=1#profile">Go</a>
      <img src="assets/a%20b.svg?v=1" srcset="data:image/png;base64,AA== 1x, assets/a%20b.svg 2x">
      <a href="https://unreachable.invalid/anything">External</a>
      <svg><g id="shape"></g><use href="#shape"></use></svg>
      <script>const template = '<img src="not-a-real-tag.png" id="入口">';</script>
      <script type="module">export const value = await Promise.resolve(1);</script>
      <script type="application/ld+json">{"@type":"WebSite"}</script>
      <script type="importmap">{"imports":{}}</script>
      <script type="x-shader/x-vertex">void main() { gl_Position = vec4(1.0); }</script>
      <link rel="stylesheet" href="css/style.css">`,
    'resume/index.html': '<h1 id="profile">Profile</h1><a href="../#%E5%85%A5%E5%8F%A3">Back</a>',
    'assets/a b.svg': '<svg></svg>',
    'css/style.css': '/* url(missing-comment.png) */ body { background: url("../assets/a%20b.svg"); }',
  });
  assert.deepEqual((await checkSite(root)).errors, []);
});

test('missing HTML/CSS resources, exact filename case and duplicate IDs fail', async t => {
  const root = await fixture(t, {
    'index.html': '<div id="same"></div><p id="same"></p><img src="assets/Missing.png"><link rel="stylesheet" href="css/style.css">',
    'assets/missing.png': 'image',
    'css/style.css': '@import "absent.css"; body { background: url(../assets/absent.svg); }',
  });
  const errors = (await checkSite(root)).errors.join('\n');
  assert.match(errors, /Duplicate HTML id "same"/);
  assert.match(errors, /assets\/Missing\.png/);
  assert.match(errors, /absent\.css/);
  assert.match(errors, /absent\.svg/);
});

test('cross-page anchors and same-origin absolute links are checked', async t => {
  const root = await fixture(t, {
    'CNAME': 'portfolio.test',
    'index.html': '<a href="resume/#missing">Bad fragment</a><a href="https://portfolio.test/absent/">Bad page</a>',
    'resume/index.html': '<h1 id="profile">Profile</h1>',
  });
  const errors = (await checkSite(root)).errors.join('\n');
  assert.match(errors, /Missing HTML anchor/);
  assert.match(errors, /absent\/index\.html/);
});

test('external, classic and inline module JavaScript syntax fails without executing code', async t => {
  const root = await fixture(t, {
    'index.html': '<script src="js/broken.js"></script><script>return 1;</script><script type="module">export const = 1;</script>',
    'js/broken.js': 'const broken = ;',
  });
  const errors = (await checkSite(root)).errors;
  assert.equal(errors.filter(error => error.includes('JavaScript syntax error')).length, 3);
});

test('manifest and sitemap targets fail when absent', async t => {
  const root = await fixture(t, {
    'index.html': '<link rel="manifest" href="site.webmanifest">',
    'site.webmanifest': JSON.stringify({ start_url: '/missing/', icons: [{ src: '/assets/missing.png' }] }),
    'sitemap.xml': '<urlset><url><loc>https://site.test/missing/</loc></url></urlset>',
  });
  const errors = (await checkSite(root)).errors.join('\n');
  assert.match(errors, /site\.webmanifest \(start_url\).*Missing published target/);
  assert.match(errors, /site\.webmanifest.*assets\/missing\.png/);
  assert.match(errors, /sitemap\.xml.*Missing published target/);
});

test('publish allowlist keeps linked reports/data and excludes repository helpers', async t => {
  const root = await fixture(t, {
    'index.html': '<h1>Site</h1>', 'README.md': 'private helper notes', 'LICENSE': 'license',
    '.github/workflows/deploy.yml': 'workflow',
    'scripts/check-site.mjs': 'build helper', 'scripts/reproduce_montecarlo.py': 'helper',
    'scripts/montecarlo_summary.json': '{}', 'scripts/montecarlo_quantiles.csv': 'value\n1',
    'snow-viz/REPORT.md': 'Public report', 'snow-viz/EXTENDED_REPORT.md': 'Public report',
    'case-studies/analysis_pipeline.py': 'helper', 'aurora-chat/README.md': 'helper',
    'aurora-chat/LICENSE': 'license', 'aurora-chat/THIRD-PARTY-NOTICES.md': 'notices',
    'aurora-chat/examples/cors-proxy-worker.js': 'helper',
    'assets/avatar.jpg': 'image',
  });
  assert.deepEqual(await collectSiteFiles(root), [
    'LICENSE', 'assets/avatar.jpg', 'aurora-chat/LICENSE', 'aurora-chat/THIRD-PARTY-NOTICES.md',
    'index.html', 'scripts/montecarlo_quantiles.csv',
    'scripts/montecarlo_summary.json', 'snow-viz/EXTENDED_REPORT.md', 'snow-viz/REPORT.md',
  ]);
});
