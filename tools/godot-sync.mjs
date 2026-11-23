#!/usr/bin/env node
/**
 * Copies the shared game data into the Godot port (godot/PORT.md):
 *   public/assets/**        -> godot/assets/**   (same relative paths; godot/assets/audio is left alone,
 *                                                 it is written by tools/render-audio.mjs)
 *   src/locales/<l>/*.json  -> godot/locales/<l>/*.json
 *   @fontsource Rajdhani 400/500/600/700 + Share Tech Mono 400 (latin, latin-ext) woff2 -> godot/fonts/
 * Only changed files are rewritten (Godot re-imports on change). Files that no longer exist in the
 * source are removed from the copies (except under godot/assets/audio).
 * Usage: npm run godot:sync
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GODOT = join(ROOT, 'godot');

let copied = 0;
let unchanged = 0;
let removed = 0;

const hash = (file) => createHash('sha1').update(readFileSync(file)).digest('hex');

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function copy(src, dst) {
  if (existsSync(dst) && statSync(dst).size === statSync(src).size && hash(dst) === hash(src)) {
    unchanged++;
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied++;
}

/** Mirrors srcDir into dstDir. `keep(relPath)` protects destination files from removal. */
function mirror(srcDir, dstDir, keep = () => false) {
  const wanted = new Set();
  for (const src of walk(srcDir)) {
    const rel = relative(srcDir, src);
    wanted.add(rel);
    copy(src, join(dstDir, rel));
  }
  for (const dst of walk(dstDir)) {
    const rel = relative(dstDir, dst);
    if (rel.endsWith('.import') || keep(rel)) continue;   // Godot import sidecars follow their file
    if (!wanted.has(rel)) {
      rmSync(dst);
      if (existsSync(`${dst}.import`)) rmSync(`${dst}.import`);
      removed++;
    }
  }
}

// Images, manifest and voice clips. godot/assets/audio belongs to tools/render-audio.mjs.
mirror(join(ROOT, 'public', 'assets'), join(GODOT, 'assets'), (rel) => rel === 'audio' || rel.startsWith(`audio${sep}`));

// Locale strings.
mirror(join(ROOT, 'src', 'locales'), join(GODOT, 'locales'));

// Fonts: the faces main.ts loads (Rajdhani has no 400 import there, but the theme may use it).
const FONTS = [
  ['rajdhani', 'rajdhani', [400, 500, 600, 700], ['latin', 'latin-ext']],
  ['share-tech-mono', 'share-tech-mono', [400], ['latin', 'latin-ext']],
];
const fontsDir = join(GODOT, 'fonts');
for (const [pkg, prefix, weights, subsets] of FONTS) {
  for (const w of weights) {
    for (const subset of subsets) {
      const name = `${prefix}-${subset}-${w}-normal.woff2`;
      const src = join(ROOT, 'node_modules', '@fontsource', pkg, 'files', name);
      if (existsSync(src)) copy(src, join(fontsDir, name));   // Share Tech Mono has no latin-ext subset
    }
  }
}

console.log(`[godot:sync] ${copied} copied, ${unchanged} unchanged, ${removed} removed`);
