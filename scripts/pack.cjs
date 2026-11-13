/* Stages runtime extension files into dist/unpacked, audits for secrets, and builds a shareable key-free ZIP. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const outDir = path.join(distDir, 'unpacked');
const GITHUB_REPO = 'rendez2k/yt-quicknav';

const RUNTIME_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'injected.js',
  'popup.html',
  'popup.js',
  'ai-client.js',
  'analysis-engine.js',
  'cut-controls.js',
  'plan-cache.js',
  'preparation.js',
  'prepare-worker.js',
  'topics.js',
  'usage-ledger.js',
  'video-tools.js',
  'video-tools-model.js',
];

const SECRET_PATTERNS = [
  { label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{10,}/ },
  { label: 'OpenAI-style API key', re: /\bsk-(?:proj|live|test)-[A-Za-z0-9_-]{10,}/ },
  { label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { label: 'Hardcoded anthropicKey value', re: /\banthropicKey\s*:\s*(['"`])(?!\1|string\1)[^'"`\r\n]+\1/ },
  { label: 'Hardcoded typesafeKey value', re: /\btypesafeKey\s*:\s*(['"`])(?!\1|string\1)[^'"`\r\n]+\1/ },
];

function auditSourceText(filename, content) {
  const text = String(content || '');
  for (const { label, re } of SECRET_PATTERNS) {
    if (re.test(text)) {
      throw new Error(`Security check failed in ${filename}: detected ${label}`);
    }
  }
  if (filename === 'cut-controls.js') {
    if (!/\banthropicKey:\s*''/.test(text) || !/\btypesafeKey:\s*''/.test(text)) {
      throw new Error('Security check failed in cut-controls.js: default API keys must be empty strings');
    }
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosDate, dosTime };
}

function createZipBuffer(entries, date = new Date()) {
  const { dosDate, dosTime } = dosDateTime(date);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const relName = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(relName, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const deflated = zlib.deflateRawSync(rawBuf, { level: 9 });
    const useDeflate = deflated.length < rawBuf.length;
    const method = useDeflate ? 8 : 0;
    const compBuf = useDeflate ? deflated : rawBuf;
    const sum = crc32(rawBuf);
    const isExec = !!entry.executable;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034B50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(sum, 14);
    localHeader.writeUInt32LE(compBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014B50, 0);
    centralHeader.writeUInt16LE(isExec ? ((3 << 8) | 20) : 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(sum, 16);
    centralHeader.writeUInt32LE(compBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(isExec ? ((0o100755 << 16) >>> 0) : 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBuf, compBuf);
    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function buildWindowsUpdater(repo = GITHUB_REPO) {
  return [
    '@echo off',
    'setlocal',
    'title YouTube Quick Nav Updater',
    'echo Checking GitHub Releases (' + repo + ') for updates...',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command ^',
    '  "$ErrorActionPreference = \'Stop\'; " ^',
    '  "$dir = (Resolve-Path \'%~dp0\').Path; " ^',
    '  "$manifestPath = Join-Path $dir \'manifest.json\'; " ^',
    '  "$localVer = if (Test-Path $manifestPath) { (Get-Content $manifestPath -Raw | ConvertFrom-Json).version } else { \'0.0.0\' }; " ^',
    '  "$rel = Invoke-RestMethod -Uri \'https://api.github.com/repos/' + repo + '/releases/latest\' -Headers @{ Accept=\'application/vnd.github+json\'; \'User-Agent\'=\'YouTubeQuickNav-Updater\' }; " ^',
    '  "$remoteVer = ($rel.tag_name -replace \'^v\',\'\').Trim(); " ^',
    '  "if ([version]$remoteVer -le [version]$localVer) { Write-Host (\'Already up to date (v\' + $localVer + \')!\') -ForegroundColor Green; exit 0 }; " ^',
    '  "$asset = $rel.assets | Where-Object { $_.name -like \'*.zip\' -and $_.browser_download_url -like \'https://github.com/' + repo + '/releases/download/*\' } | Select-Object -First 1; " ^',
    '  "if (-not $asset) { throw \'No verified release .zip asset found on GitHub.\' }; " ^',
    '  "$tmpZip = Join-Path $env:TEMP (\'yqn-update-\' + [guid]::NewGuid().ToString(\'N\') + \'.zip\'); " ^',
    '  "$tmpStage = Join-Path $env:TEMP (\'yqn-stage-\' + [guid]::NewGuid().ToString(\'N\')); " ^',
    '  "try { " ^',
    '  "  Write-Host (\'Downloading v\' + $remoteVer + \'...\'); " ^',
    '  "  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmpZip -UseBasicParsing; " ^',
    '  "  Expand-Archive -Path $tmpZip -DestinationPath $tmpStage -Force; " ^',
    '  "  if (-not (Test-Path (Join-Path $tmpStage \'manifest.json\'))) { throw \'Downloaded archive is missing manifest.json\' }; " ^',
    '  "  Copy-Item -Path (Join-Path $tmpStage \'*\') -Destination $dir -Recurse -Force; " ^',
    '  "  Write-Host (\'Updated from v\' + $localVer + \' to v\' + $remoteVer + \'!\') -ForegroundColor Green; " ^',
    '  "  Write-Host \'Next step: Open chrome://extensions and click Reload on YouTube Quick Nav.\' -ForegroundColor Cyan; " ^',
    '  "} finally { " ^',
    '  "  Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue; " ^',
    '  "  Remove-Item $tmpStage -Recurse -Force -ErrorAction SilentlyContinue; " ^',
    '  "}"',
    'echo.',
    'pause',
    '',
  ].join('\r\n');
}

function buildUnixUpdater(repo = GITHUB_REPO) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    'echo "Checking GitHub Releases (' + repo + ') for updates..."',
    'INFO="$(DIR="$DIR" python3 - <<\'PY\'',
    'import json, os, urllib.request',
    'repo = "' + repo + '"',
    'dir_path = os.environ["DIR"]',
    'manifest_path = os.path.join(dir_path, "manifest.json")',
    'local_ver = "0.0.0"',
    'if os.path.exists(manifest_path):',
    '    with open(manifest_path, "r", encoding="utf-8") as f:',
    '        local_ver = json.load(f).get("version", "0.0.0")',
    'req = urllib.request.Request(',
    '    "https://api.github.com/repos/' + repo + '/releases/latest",',
    '    headers={"Accept": "application/vnd.github+json", "User-Agent": "YouTubeQuickNav-Updater"},',
    ')',
    'with urllib.request.urlopen(req, timeout=15) as resp:',
    '    rel = json.loads(resp.read().decode("utf-8"))',
    'remote_ver = str(rel.get("tag_name", "")).lstrip("vV").strip()',
    'def parse_v(v): return tuple(int(x) for x in v.split("."))',
    'if parse_v(remote_ver) <= parse_v(local_ver):',
    '    print(f"UP_TO_DATE|{local_ver}|")',
    'else:',
    '    prefix = f"https://github.com/{repo}/releases/download/"',
    '    url = next((a["browser_download_url"] for a in rel.get("assets", []) if str(a.get("name", "")).endswith(".zip") and str(a.get("browser_download_url", "")).startswith(prefix)), "")',
    '    if not url:',
    '        raise SystemExit("No verified release .zip asset found on GitHub.")',
    '    print(f"UPDATE|{remote_ver}|{url}")',
    'PY',
    ')"',
    'STATUS="${INFO%%|*}"',
    'REST="${INFO#*|}"',
    'VER="${REST%%|*}"',
    'URL="${REST#*|}"',
    'if [ "$STATUS" = "UP_TO_DATE" ]; then',
    '  echo "Already up to date (v$VER)!"',
    '  read -r -p "Press Enter to close..." _ || true',
    '  exit 0',
    'fi',
    'TMP_DIR="$(mktemp -d)"',
    'trap \'rm -rf "$TMP_DIR"\' EXIT',
    'echo "Downloading v$VER..."',
    'curl -fsSL "$URL" -o "$TMP_DIR/update.zip"',
    'unzip -oq "$TMP_DIR/update.zip" -d "$TMP_DIR/stage"',
    '[ -f "$TMP_DIR/stage/manifest.json" ] || { echo "Error: manifest.json missing in archive"; exit 1; }',
    'cp -Rf "$TMP_DIR/stage/." "$DIR/"',
    'chmod +x "$DIR/Update-Mac-Linux.command" 2>/dev/null || true',
    'echo "Updated to v$VER! Open chrome://extensions and click Reload on YouTube Quick Nav."',
    'read -r -p "Press Enter to close..." _ || true',
    '',
  ].join('\n');
}

function buildInstallGuide(version) {
  return [
    `YouTube Quick Nav v${version} — Friend Install & Update Guide`,
    '============================================================',
    '',
    'Zero API keys or accounts are included or required.',
    'All settings, notes, and speeds stay local in your own browser.',
    '',
    'How to install in Chrome / Brave / Edge:',
    '1. Extract (unzip) this archive to a permanent folder on your computer',
    '   (for example: Documents/youtube-quick-nav).',
    '   Keep that folder after installing — Chrome loads unpacked extensions from it.',
    '2. Open Chrome and navigate to:  chrome://extensions',
    '   (Brave: brave://extensions  |  Edge: edge://extensions)',
    '3. Turn ON "Developer mode" in the top-right corner.',
    '4. Click "Load unpacked" (top-left) and select the extracted folder',
    '   (the folder that directly contains manifest.json).',
    '5. Open or refresh any YouTube video tab — you are ready to go!',
    '',
    'How to update when a new version is released:',
    '- The extension popup shows an "Update available" badge automatically.',
    '- Windows: Double-click Update-Windows.cmd inside your extension folder.',
    '- macOS / Linux: Double-click Update-Mac-Linux.command inside your folder.',
    '- Then click Reload on YouTube Quick Nav in chrome://extensions.',
    '  (All your settings, channel speeds, and saved notes are preserved!)',
    '',
    'Included free out of the box (no keys needed):',
    '- Auto-Cut: SponsorBlock community skips + POI highlights, Most Replayed peaks,',
    '  and real-time Web Audio silence speedup',
    '- TL;DR card & playable highlight reel (Shift+T) with Skim / Balanced / Deep modes',
    '- Live-synced transcript search & 1-click timestamped quote copy (Shift+F)',
    '- Per-channel playback speed memory, A-B section loop (Shift+L), and',
    '  clean full-resolution video frame capture (Shift+S)',
    '- Cinema mode, up to 300% volume boost + loudness leveling, clean end-screens,',
    '  and Shorts -> Full player button (Shift+W)',
    '',
  ].join('\r\n');
}

function buildPackage() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    throw new Error(`Version mismatch: manifest.json (${manifest.version}) !== package.json (${pkg.version})`);
  }

  fs.mkdirSync(distDir, { recursive: true });
  for (const existing of fs.readdirSync(distDir)) {
    if (/^youtube-quick-nav-v.*\.zip$/i.test(existing)) {
      fs.rmSync(path.join(distDir, existing), { force: true });
    }
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'icons'), { recursive: true });

  const zipEntries = [];

  for (const file of RUNTIME_FILES) {
    const srcPath = path.join(root, file);
    const content = fs.readFileSync(srcPath, 'utf8');
    auditSourceText(file, content);
    fs.copyFileSync(srcPath, path.join(outDir, file));
    zipEntries.push({ name: file, data: fs.readFileSync(srcPath) });
  }

  for (const icon of fs.readdirSync(path.join(root, 'icons')).sort()) {
    if (icon.endsWith('.png')) {
      const srcPath = path.join(root, 'icons', icon);
      fs.copyFileSync(srcPath, path.join(outDir, 'icons', icon));
      zipEntries.push({ name: `icons/${icon}`, data: fs.readFileSync(srcPath) });
    }
  }

  const installGuideBuf = Buffer.from(buildInstallGuide(manifest.version), 'utf8');
  const winUpdaterBuf = Buffer.from(buildWindowsUpdater(GITHUB_REPO), 'utf8');
  const unixUpdaterBuf = Buffer.from(buildUnixUpdater(GITHUB_REPO), 'utf8');
  fs.writeFileSync(path.join(outDir, 'HOW-TO-INSTALL.txt'), installGuideBuf);
  fs.writeFileSync(path.join(outDir, 'Update-Windows.cmd'), winUpdaterBuf);
  fs.writeFileSync(path.join(outDir, 'Update-Mac-Linux.command'), unixUpdaterBuf, { mode: 0o755 });

  zipEntries.push(
    { name: 'HOW-TO-INSTALL.txt', data: installGuideBuf },
    { name: 'Update-Windows.cmd', data: winUpdaterBuf },
    { name: 'Update-Mac-Linux.command', data: unixUpdaterBuf, executable: true }
  );

  let unpackedBytes = 0;
  const countBytes = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) countBytes(full);
      else unpackedBytes += fs.statSync(full).size;
    }
  };
  countBytes(outDir);

  const zipName = `youtube-quick-nav-v${manifest.version}.zip`;
  const zipPath = path.join(distDir, zipName);
  const zipBuf = createZipBuffer(zipEntries);
  fs.writeFileSync(zipPath, zipBuf);

  console.log(`Secret audit passed: 0 API keys or personal data in ${RUNTIME_FILES.length} runtime files`);
  console.log(`Staged clean unpacked extension to ${outDir} (${(unpackedBytes / 1024).toFixed(1)} KB)`);
  console.log(`Built shareable friend package: ${zipPath} (${(zipBuf.length / 1024).toFixed(1)} KB)`);

  return { version: manifest.version, outDir, zipPath, zipBytes: zipBuf.length };
}

if (require.main === module) {
  buildPackage();
}

module.exports = { GITHUB_REPO, auditSourceText, createZipBuffer, buildWindowsUpdater, buildUnixUpdater, buildPackage };
