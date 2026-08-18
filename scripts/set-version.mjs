#!/usr/bin/env node
// 统一全局产品版本号。
//
// 唯一版本来源：.release-please-manifest.json（= GitHub Release tag，如 0.2.0）。
// release-please 只维护该 manifest 文件，本脚本负责把它“扇出”到所有需要版本号的产物：
//   - 根 package.json
//   - packages/*/package.json（backend / admin-web / mobile-h5 / tv-app / shared / separator ...）
//   - packages/tv-app/src-tauri/tauri.conf.json（Tauri 打包版本）
//   - packages/separator/pyproject.toml、packages/downloader/pyproject.toml（Python 微服务版本）
//
// 调用：
//   node scripts/set-version.mjs            # 无参数：从 manifest 读取（本地 dev/build 用）
//   node scripts/set-version.mjs 1.2.3      # 显式版本（CI 发布时用，= git tag 去 v）
//
// 版本来源优先级：argv[2] > 环境变量 GITHUB_REF_NAME / TAG（去 v）> .release-please-manifest.json
//
// 仅当内容真正变化时才写文件，避免产生无意义的 git diff / 文件 mtime 抖动。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function resolveVersion() {
  const arg = process.argv[2];
  if (arg) return arg.replace(/^v/, '');
  const ref = process.env.GITHUB_REF_NAME || process.env.TAG || '';
  if (ref.startsWith('v')) return ref.slice(1);
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(root, '.release-please-manifest.json'), 'utf-8')
    );
    if (manifest && manifest['.']) return manifest['.'];
  } catch {
    /* ignore */
  }
  return '0.0.0';
}

const version = resolveVersion();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[set-version] invalid version: "${version}"`);
  process.exit(1);
}

// 1) 所有 JSON 目标：根 + 各 packages/*/package.json + tauri.conf.json
const jsonTargets = [
  'package.json',
  ...readdirSync(resolve(root, 'packages'))
    .filter((name) => existsSync(resolve(root, 'packages', name, 'package.json')))
    .map((name) => `packages/${name}/package.json`),
  'packages/tv-app/src-tauri/tauri.conf.json',
];

let changed = 0;
for (const rel of jsonTargets) {
  const p = resolve(root, rel);
  const raw = readFileSync(p, 'utf-8');
  const json = JSON.parse(raw);
  if (json.version === version) {
    console.log(`[set-version] ${rel} already ${version}`);
    continue;
  }
  json.version = version;
  writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf-8');
  console.log(`[set-version] ${rel} -> ${version}`);
  changed += 1;
}

// 2) Python 微服务的 pyproject.toml（PEP 621：version = "x.y.z"）
for (const pkg of ['separator', 'downloader']) {
  const pyproject = resolve(root, `packages/${pkg}/pyproject.toml`);
  if (!existsSync(pyproject)) continue;
  const raw = readFileSync(pyproject, 'utf-8');
  const updated = raw.replace(/^(version\s*=\s*")([^"]*)(")/m, `$1${version}$3`);
  if (updated !== raw) {
    writeFileSync(pyproject, updated, 'utf-8');
    console.log(`[set-version] packages/${pkg}/pyproject.toml -> ${version}`);
    changed += 1;
  } else {
    console.log(`[set-version] packages/${pkg}/pyproject.toml already ${version}`);
  }
}

console.log(`[set-version] done (${version})${changed ? `, ${changed} file(s) updated` : ', no change'}`);
