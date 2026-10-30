#!/usr/bin/env node
// Offline checks for the files that are actually published. Requires Node.js 22+.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_DIRECTORIES = [
  'assets', 'aurora-chat', 'campus-map', 'case-studies', 'claude-anti-ban',
  'css', 'forbidden-city', 'galaxy', 'js', 'ming-history', 'resume', 'school',
  'snow-viz', 'stats-lab', 'student-score', 'words', 'xueji',
];
const ROOT_FILES = ['index.html', '404.html', 'CNAME', 'robots.txt', 'site.webmanifest', 'sitemap.xml', 'LICENSE'];
// These are linked public reports/data, not the scripts that generated them.
const PUBLIC_DATA = [
  'scripts/montecarlo_summary.json', 'scripts/montecarlo_quantiles.csv',
  'snow-viz/REPORT.md', 'snow-viz/EXTENDED_REPORT.md',
  'aurora-chat/LICENSE', 'aurora-chat/THIRD-PARTY-NOTICES.md',
];
const PUBLIC_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.json', '.csv', '.svg', '.png', '.jpg', '.jpeg',
  '.webp', '.gif', '.ico', '.avif', '.mp3', '.wav', '.ogg', '.pdf',
  '.woff', '.woff2', '.ttf', '.otf', '.srt', '.vtt', '.webmanifest', '.zip',
]);

export async function collectSiteFiles(root) {
  const files = [];
  async function visit(relative) {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.') || entry.name === 'examples') continue;
      if (entry.isSymbolicLink()) throw new Error(`Cannot publish a symbolic link: ${name}`);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && PUBLIC_EXTENSIONS.has(path.extname(name).toLowerCase())) files.push(name);
    }
  }
  for (const directory of SITE_DIRECTORIES) await visit(directory);
  for (const name of [...ROOT_FILES, ...PUBLIC_DATA]) {
    try { await readFile(path.join(root, name)); files.push(name); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return [...new Set(files)].sort();
}

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[entity.toLowerCase()] ?? match;
  });
}

function attributes(text) {
  const result = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!result.has(name)) result.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return result;
}

// Read tags without mistaking comments, JS strings, or quoted > characters for HTML.
function htmlTags(source) {
  const tags = [];
  let cursor = 0;
  while ((cursor = source.indexOf('<', cursor)) !== -1) {
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    const start = /^<([a-z][\w:-]*)\b/i.exec(source.slice(cursor));
    if (!start) { cursor++; continue; }
    let end = cursor + start[0].length;
    let quote = '';
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    const tag = { name: start[1].toLowerCase(), attrs: attributes(source.slice(cursor + start[0].length, end)), offset: cursor };
    cursor = end + 1;
    if (['script', 'style', 'textarea', 'title'].includes(tag.name)) {
      const closing = new RegExp(`</${tag.name}\\s*>`, 'ig');
      closing.lastIndex = cursor;
      const match = closing.exec(source);
      tag.body = source.slice(cursor, match ? match.index : source.length);
      tag.bodyOffset = cursor;
      cursor = match ? closing.lastIndex : source.length;
    }
    tags.push(tag);
  }
  return tags;
}

function cssReferences(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const result = [];
  for (const match of clean.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*?))\s*\)/gi)) {
    result.push((match[1] ?? match[2] ?? match[3]).trim());
  }
  for (const match of clean.matchAll(/@import\s+["']([^"']+)["']/gi)) result.push(match[1]);
  return result;
}

function srcsetReferences(value) {
  // Commas inside data: URLs belong to the URL; descriptors follow whitespace.
  return [...value.matchAll(/(?:^|,\s*)(data:[^\s]+|[^\s,]+)(?:\s+[^,]*)?/g)].map(match => match[1].replace(/,$/, ''));
}

export async function checkSite(root = ROOT) {
  const files = await collectSiteFiles(root);
  const published = new Set(files);
  const errors = [];
  const html = new Map();
  const references = [];
  const scripts = [];
  const scriptTypes = new Map();
  const manifests = new Set(files.filter(file => file.endsWith('.webmanifest')));
  let origin = 'https://site.test';
  if (published.has('CNAME')) origin = new URL(`https://${(await readFile(path.join(root, 'CNAME'), 'utf8')).trim()}`).origin;
  const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;
  const addError = (location, message) => errors.push(`${location}: ${message}`);
  if (!published.has('index.html')) addError('index.html', 'Missing site entry point');

  function resolveLocal(value, base, location) {
    let url;
    try { url = new URL(value.trim(), base); }
    catch { addError(location, `Invalid URL ${JSON.stringify(value)}`); return null; }
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== new URL(origin).hostname) return null;
    let target;
    try { target = decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
    catch { addError(location, `Invalid URL encoding ${JSON.stringify(value)}`); return null; }
    if (target.endsWith('/') || !target) target += 'index.html';
    // Match exact filename case even when the checker runs on Windows.
    if (!published.has(target)) {
      addError(location, `Missing published target ${JSON.stringify(value)} (${target})`);
      return null;
    }
    return { target, url };
  }
  function reference(value, base, location, anchor = false) {
    if (value == null || !value.trim()) return;
    references.push({ value, base, location, anchor });
  }

  for (const file of files.filter(name => name.endsWith('.html'))) {
    const source = await readFile(path.join(root, file), 'utf8');
    const tags = htmlTags(source);
    const documentUrl = new URL(file, `${origin}/`);
    const baseTag = tags.find(tag => tag.name === 'base' && tag.attrs.has('href'));
    const base = baseTag ? new URL(baseTag.attrs.get('href'), documentUrl) : documentUrl;
    const ids = new Set();
    const anchors = new Set();
    for (const tag of tags) {
      const location = `${file}:${lineAt(source, tag.offset)}`;
      const id = tag.attrs.get('id');
      if (id !== undefined) {
        if (ids.has(id)) addError(location, `Duplicate HTML id ${JSON.stringify(id)}`);
        ids.add(id);
        anchors.add(id);
      }
      if (tag.name === 'a' && tag.attrs.has('name')) anchors.add(tag.attrs.get('name'));
      for (const name of ['src', 'href', 'poster', 'data-src', 'xlink:href']) {
        if (tag.name === 'base' && name === 'href') continue;
        reference(tag.attrs.get(name), base, location, name === 'href' || name === 'xlink:href');
      }
      if (tag.name === 'object') reference(tag.attrs.get('data'), base, location);
      for (const name of ['srcset', 'imagesrcset']) {
        for (const value of srcsetReferences(tag.attrs.get(name) ?? '')) reference(value, base, location);
      }
      for (const value of cssReferences(tag.attrs.get('style') ?? '')) {
        if (!value.startsWith('#')) reference(value, base, location);
      }
      if (tag.name === 'style') {
        for (const value of cssReferences(tag.body)) if (!value.startsWith('#')) reference(value, base, location);
      }
      if (tag.name === 'link' && /(?:^|\s)manifest(?:\s|$)/i.test(tag.attrs.get('rel') ?? '')) {
        const resolved = resolveLocal(tag.attrs.get('href') ?? '', base, location);
        if (resolved) manifests.add(resolved.target);
      }
      if (tag.name === 'script') {
        const type = (tag.attrs.get('type') ?? '').trim().toLowerCase().split(';')[0];
        if (!['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) continue;
        if (tag.attrs.has('src')) {
          const resolved = resolveLocal(tag.attrs.get('src'), base, location);
          if (resolved) scriptTypes.set(resolved.target, type === 'module' ? 'module' : 'commonjs');
        } else if (tag.body.trim()) {
          scripts.push({ source: tag.body, location: `${file}:${lineAt(source, tag.bodyOffset)}`, type: type === 'module' ? 'module' : 'commonjs' });
        }
      }
    }
    html.set(file, anchors);
  }

  for (const file of files.filter(name => name.endsWith('.css'))) {
    const css = await readFile(path.join(root, file), 'utf8');
    for (const value of cssReferences(css)) if (!value.startsWith('#')) reference(value, new URL(file, `${origin}/`), file);
  }
  for (const file of manifests) {
    try {
      const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
      const base = new URL(file, `${origin}/`);
      for (const field of ['start_url', 'scope']) reference(manifest[field], base, `${file} (${field})`, true);
      for (const icon of [...(manifest.icons ?? []), ...(manifest.screenshots ?? [])]) reference(icon.src, base, file);
      for (const shortcut of manifest.shortcuts ?? []) {
        reference(shortcut.url, base, `${file} (shortcut)`, true);
        for (const icon of shortcut.icons ?? []) reference(icon.src, base, file);
      }
    } catch (error) { addError(file, `Invalid web manifest: ${error.message}`); }
  }
  if (published.has('sitemap.xml')) {
    const xml = await readFile(path.join(root, 'sitemap.xml'), 'utf8');
    const locations = [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)];
    if (!locations.length) addError('sitemap.xml', 'No sitemap targets found');
    for (const match of locations) {
      const value = decodeEntities(match[1].trim());
      const location = `sitemap.xml:${lineAt(xml, match.index)}`;
      try {
        if (new URL(value).hostname !== new URL(origin).hostname) addError(location, `Sitemap target is outside site origin: ${value}`);
        else reference(value, `${origin}/`, location, true);
      } catch { addError(location, `Invalid sitemap target: ${value}`); }
    }
  }
  for (const item of references) {
    const resolved = resolveLocal(item.value, item.base, item.location);
    if (!resolved || !item.anchor || !resolved.url.hash || !html.has(resolved.target)) continue;
    let fragment;
    try { fragment = decodeURIComponent(resolved.url.hash.slice(1)).split(':~:')[0]; }
    catch { addError(item.location, `Invalid fragment encoding ${JSON.stringify(item.value)}`); continue; }
    if (fragment && !html.get(resolved.target).has(fragment)) addError(item.location, `Missing HTML anchor ${JSON.stringify(item.value)}`);
  }
  for (const file of files.filter(name => name.endsWith('.js'))) {
    const source = await readFile(path.join(root, file), 'utf8');
    const type = scriptTypes.get(file) ?? (/^\s*(?:import|export)\b/m.test(source) ? 'module' : 'commonjs');
    scripts.push({ source, location: file, type });
  }
  for (const script of scripts) {
    if (script.type !== 'module') {
      // Classic browser scripts disallow top-level return/import/export.
      try { new Script(script.source, { filename: script.location }); }
      catch (error) { addError(script.location, `JavaScript syntax error: ${error.message}`); }
      continue;
    }
    // --check parses modules without executing or resolving/fetching imports.
    const result = spawnSync(process.execPath, ['--check', `--input-type=${script.type}`], {
      input: script.source, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error) addError(script.location, `JavaScript check failed: ${result.error.message}`);
    else if (result.status !== 0) addError(script.location, `JavaScript syntax error\n${result.stderr.trim()}`);
  }
  return { files, errors, counts: { html: html.size, css: files.filter(name => name.endsWith('.css')).length, scripts: scripts.length, references: references.length } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;
    const result = await checkSite(root);
    if (result.errors.length) {
      console.error(result.errors.join('\n'));
      console.error(`\nSite check failed: ${result.errors.length} error(s).`);
      process.exitCode = 1;
    } else console.log(`Site check passed: ${result.counts.html} HTML, ${result.counts.css} CSS, ${result.counts.scripts} scripts, ${result.counts.references} local/external references inspected offline.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
