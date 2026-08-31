import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const distDir = path.join(desktopDir, 'dist');
const expectedVersion = '0.2.1';
const expectedSourceCommit = '4a67226e18cb003db1210357ea4a283774773acc';
const expectedNoticeSha256 = '2acf865e87e59090121369aac0575467067fdd7999923a70d785a46ceae3330f';
const noticeAttributeRules = [
  'frontends/desktop/public/THIRD_PARTY_NOTICES.txt text eol=lf',
  'frontends/desktop/dist/THIRD_PARTY_NOTICES.txt text eol=lf',
];
const excludedManifestFiles = new Set(['README.md', 'build-provenance.json']);
const removedLegacyAssets = [
  'styles.css',
  'i18n.js',
  'phosphor-icons.js',
  'vendor/marked.min.js',
  'assets/fonts/fonts.css',
  'assets/fonts/README.md',
  'assets/fonts/azonix-wordmark.woff2',
  'assets/fonts/jetbrains-mono-latin.woff2',
  'assets/fonts/lexend-latin.woff2',
  'assets/fonts/noto-sans-latin.woff2',
];
const semiPackages = [
  '@douyinfe/semi-animation',
  '@douyinfe/semi-animation-react',
  '@douyinfe/semi-animation-styled',
  '@douyinfe/semi-foundation',
  '@douyinfe/semi-icons',
  '@douyinfe/semi-illustrations',
  '@douyinfe/semi-json-viewer-core',
  '@douyinfe/semi-theme-default',
  '@douyinfe/semi-ui',
];

function fail(message) {
  throw new Error(message);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function relativeToDist(file) {
  return path.relative(distDir, file).split(path.sep).join('/');
}

async function assertExists(relativePath) {
  if (!await exists(path.join(distDir, relativePath))) {
    fail(`missing compiled asset: ${relativePath}`);
  }
}

function workflowJob(workflow, name) {
  const match = new RegExp(`^  ${name}:\\s*$`, 'm').exec(workflow);
  if (!match) return '';
  const remainder = workflow.slice(match.index + match[0].length);
  const nextJob = /^  [a-zA-Z0-9_-]+:\s*$/m.exec(remainder);
  return nextJob ? remainder.slice(0, nextJob.index) : remainder;
}

async function verifyHtmlReferences(relativePath) {
  const html = await readFile(path.join(distDir, relativePath), 'utf8');
  const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
  for (const reference of references) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue;
    const cleanReference = reference.split(/[?#]/, 1)[0].replace(/^\//, '');
    if (cleanReference) await assertExists(cleanReference);
  }
}

function verifyTrackedSourceBoundary() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const forbidden = tracked.filter((file) => (
    file.startsWith('frontends/desktop/src/')
    || file.startsWith('frontends/desktop/public/')
    || file.startsWith('frontends/desktop/e2e/')
    || /^frontends\/desktop\/(?:index|loading|setup)\.html$/.test(file)
    || /^frontends\/desktop\/(?:vite\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json|package-lock\.json)$/.test(file)
  ));
  if (forbidden.length > 0) {
    fail(`tracked React development files crossed the compiled-only boundary: ${forbidden.join(', ')}`);
  }
}

async function verifyNoticeAttributes() {
  const attributes = await readFile(path.join(repoRoot, '.gitattributes'), 'utf8');
  const lines = attributes.split(/\r?\n/);
  for (const rule of noticeAttributeRules) {
    const noticePath = rule.split(/\s+/, 1)[0];
    const matchingRules = lines.filter((line) => line.trim().split(/\s+/, 1)[0] === noticePath);
    if (matchingRules.length !== 1 || matchingRules[0] !== rule) {
      fail(`third-party notice must have one exact LF attribute rule: ${rule}`);
    }
  }
}

async function verifyVersionsRendererAndEntry() {
  const packageJson = await readJson(path.join(desktopDir, 'package.json'));
  const tauriConfig = await readJson(path.join(desktopDir, 'src-tauri', 'tauri.conf.json'));
  const tauriE2eConfig = await readJson(path.join(desktopDir, 'src-tauri', 'tauri.e2e.conf.json'));
  const cargoToml = await readFile(path.join(desktopDir, 'src-tauri', 'Cargo.toml'), 'utf8');
  const cargoLock = await readFile(path.join(desktopDir, 'src-tauri', 'Cargo.lock'), 'utf8');
  const desktopShell = await readFile(path.join(desktopDir, 'src-tauri', 'src', 'lib.rs'), 'utf8');

  if (packageJson.version !== expectedVersion) fail(`package.json version must be ${expectedVersion}`);
  if (tauriConfig.version !== expectedVersion) fail(`tauri.conf.json version must be ${expectedVersion}`);
  if (tauriConfig.build?.frontendDist !== '../dist') fail('Tauri frontendDist must be ../dist');
  for (const sourceBuildKey of ['beforeBuildCommand', 'beforeDevCommand', 'devUrl']) {
    if (sourceBuildKey in tauriConfig.build) fail(`compiled-only Tauri config must not require ${sourceBuildKey}`);
  }
  if (!/^\[package\][\s\S]*?^name = "ga-desktop"$[\s\S]*?^version = "0\.2\.1"$/m.test(cargoToml)) {
    fail(`Cargo.toml ga-desktop version must be ${expectedVersion}`);
  }
  if (!/^\[\[package\]\][\s\S]*?^name = "ga-desktop"$\nversion = "0\.2\.1"$/m.test(cargoLock)) {
    fail(`Cargo.lock ga-desktop version must be ${expectedVersion}`);
  }

  const productionSecurity = tauriConfig.app?.security;
  if (!productionSecurity?.csp || typeof productionSecurity.csp !== 'object') {
    fail('production renderer must use an explicit CSP');
  }
  if (String(productionSecurity.csp['script-src']).includes('unsafe-eval')) {
    fail('production CSP must not enable unsafe-eval');
  }
  if (!String(productionSecurity.csp['connect-src']).includes('127.0.0.1:14168')) {
    fail('production CSP must retain the Desktop loopback bridge');
  }
  if (JSON.stringify(productionSecurity).includes('wdio:')) {
    fail('production Tauri security config must not grant WebDriver permissions');
  }
  if (!JSON.stringify(tauriE2eConfig).includes('wdio:default')) {
    fail('E2E-only Tauri config must retain its isolated WebDriver capability');
  }
  if (!desktopShell.includes('fn main_ui_url_from_current')) {
    fail('desktop shell must resolve index.html from the active Tauri asset origin');
  }
  if (/tauri::Url::parse\("http:\/\/127\.0\.0\.1:14168\/?"\)/.test(desktopShell)) {
    fail('desktop shell must not navigate the renderer to the legacy bridge root');
  }
}

async function verifyReleaseContract() {
  const workflow = await readFile(
    path.join(repoRoot, '.github', 'workflows', 'desktop-release-package.yml'),
    'utf8',
  );
  const buildJobs = ['build-windows', 'build-linux', 'build-macos'];
  const tauriCommands = {
    'build-windows': 'npm run tauri build -- --bundles nsis',
    'build-linux': 'npm run tauri build -- --bundles appimage',
    'build-macos': 'npm run tauri build -- --bundles app',
  };
  const jobNames = [...workflow.slice(workflow.search(/^jobs:\s*$/m)).matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)]
    .map((match) => match[1]);
  if (JSON.stringify(jobNames) !== JSON.stringify([...buildJobs, 'publish-release'])) {
    fail('release workflow must contain exactly three builders and one publisher');
  }
  if (!/^permissions:\n  contents: read\s*$/m.test(workflow)) {
    fail('release workflow must default to contents: read');
  }
  if ((workflow.match(/^      contents: write\s*$/gm) ?? []).length !== 1) {
    fail('release workflow must grant contents: write exactly once');
  }
  if ((workflow.match(/^        run: npm run test:dist$/gm) ?? []).length !== 3) {
    fail('all three builders must run the compiled renderer byte contract');
  }
  if (/\bnpm ci\b|\bnpm run build\b|\b(?:npx|npm exec)\s+vite\b/.test(workflow)) {
    fail('compiled-only release workflow must not require the React source toolchain');
  }

  for (const job of buildJobs) {
    const body = workflowJob(workflow, job);
    if (!body) fail(`missing release builder: ${job}`);
    if (!/^    permissions:\n      contents: read\s*$/m.test(body) || body.includes('contents: write')) {
      fail(`${job} must have read-only repository permission`);
    }
    if (!/uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n        with:\n          persist-credentials: false/.test(body)) {
      fail(`${job} checkout must use a full SHA and disable persisted credentials`);
    }
    if (body.includes('secrets.GITHUB_TOKEN') || /\bgh release\b/.test(body)) {
      fail(`${job} must not receive a release token or publish`);
    }
    if (!body.includes('npm install --package-lock=false')
        || !body.includes("if(v!=='2.11.4')")
        || !body.includes('test ! -e package-lock.json')
        || body.includes('npm ci')) {
      fail(`${job} must install only the submitted minimal Tauri package manifest`);
    }
    const adjacentGate = new RegExp(
      '      - name: Verify tracked compiled renderer bytes\\n'
      + '        working-directory: frontends/desktop\\n'
      + '        run: npm run test:dist\\n\\n'
      + '      - name: [^\\n]+\\n'
      + '        working-directory: frontends/desktop\\n'
      + `        run: ${tauriCommands[job].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    );
    if (!adjacentGate.test(body)) {
      fail(`${job} must validate notice bytes immediately before Tauri embeds dist`);
    }
    if (!(body.includes("--exclude='./frontends/desktop/dist'")
          || body.includes("--exclude='frontends/desktop/dist'"))) {
      fail(`${job} must not duplicate Tauri-embedded dist inside runtime/app`);
    }
    if (!/--exclude='(?:\.\/)?frontends\/desktop\/release_qualification'/.test(body)) {
      fail(`${job} must not package release qualification tooling inside runtime/app`);
    }
    if (!(body.includes('test ! -e "$RUNTIME/app/frontends/desktop/dist"')
          || body.includes('test ! -e "$RUNTIME_SRC/app/frontends/desktop/dist"'))) {
      fail(`${job} must verify dist is not duplicated inside runtime/app`);
    }
  }

  const windows = workflowJob(workflow, 'build-windows');
  if (!windows.includes('cygpath -u "$RUNNER_TEMP"')
      || !windows.includes('PBS_ARCHIVE="${RUNNER_TEMP_POSIX}/pbs-windows-x86_64.tar.gz"')) {
    fail('Windows packaging must convert RUNNER_TEMP with cygpath before POSIX tools use it');
  }
  const macos = workflowJob(workflow, 'build-macos');
  if (!macos.includes('runs-on: macos-26')
      || !macos.includes('DEVELOPER_DIR: /Applications/Xcode_26.5.app/Contents/Developer')
      || !macos.includes('test "$(uname -m)" = arm64')
      || !macos.includes('test "$(xcodebuild -version | sed -n \'1p\')" = "Xcode 26.5"')
      || !macos.includes('test "$(xcodebuild -version | sed -n \'2p\')" = "Build version 17F42"')
      || !macos.includes('test "$(xcrun --sdk macosx --show-sdk-version)" = "26.5"')
      || !workflow.includes('MACOS_PACKAGING_PYTHON_VERSION: "3.12.10"')
      || !workflow.includes('PBS_PYTHON_VERSION: "3.12.14"')) {
    fail('macOS packaging must pin macos-26, Xcode 26.5 build 17F42, SDK 26.5, arm64, and separate Python inputs');
  }
  const linux = workflowJob(workflow, 'build-linux');
  if (!linux.includes('runs-on: ubuntu-22.04')
      || !linux.includes('prefix-key: "v1-rust-release-ubuntu-22.04-glibc-2.35"')
      || linux.includes('prefix-key: "v0-rust"')
      || !linux.includes('cache-targets: "false"')
      || !linux.includes('cache-bin: "false"')) {
    fail('Linux packaging must isolate its Ubuntu 22.04/glibc 2.35 Rust cache ABI');
  }

  const publisher = workflowJob(workflow, 'publish-release');
  if (!publisher.includes('needs: [build-windows, build-linux, build-macos]')
      || !publisher.includes("github.event_name == 'push'")
      || !publisher.includes('refs/tags/desktop-portable-')
      || !/^    permissions:\n      contents: write\s*$/m.test(publisher)) {
    fail('publisher must be the sole tag-only writer after all three builders');
  }
  const publisherRun = publisher.slice(publisher.indexOf('        run: |'));
  if (!publisher.includes('TAG_NAME: ${{ github.ref_name }}')
      || publisherRun.includes('${{ github.ref_name }}')
      || !publisherRun.includes('^desktop-portable-[A-Za-z0-9._-]+$')) {
    fail('publisher must pass the tag through env and validate it before shell use');
  }
  if ((publisher.match(/actions\/download-artifact@/g) ?? []).length !== 3
      || (publisher.match(/\bgh release create\b/g) ?? []).length !== 1
      || publisher.includes('gh release upload')
      || !publisher.includes('--draft')
      || !publisher.includes('gh release edit "$TAG_NAME" --draft=false --prerelease')) {
    fail('publisher must aggregate three artifacts as a verified draft, then expose one prerelease');
  }
  for (const file of [
    'GenericAgent-Desktop-Windows-Portable.zip',
    'SHA256SUMS-windows.txt',
    'GenericAgent-Desktop-Linux-Portable.tar.gz',
    'SHA256SUMS-linux.txt',
    'GenericAgent-Desktop-macOS-aarch64.dmg',
    'GenericAgent-Desktop-macOS-aarch64.dmg.sha256',
  ]) {
    if (!publisher.includes(file)) fail(`publisher does not require release asset: ${file}`);
  }
}

async function verifyGeneratedManifest(files) {
  const provenance = await readJson(path.join(distDir, 'build-provenance.json'));
  const generatedFiles = files
    .map((file) => ({ file, relativePath: relativeToDist(file) }))
    .filter(({ relativePath }) => !excludedManifestFiles.has(relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));

  const manifestLines = [];
  for (const { file, relativePath } of generatedFiles) {
    manifestLines.push(`${sha256(await readFile(file))}  ${relativePath}\n`);
  }
  const manifestDigest = sha256(manifestLines.join(''));

  if (provenance.version !== expectedVersion) fail(`provenance version must be ${expectedVersion}`);
  if (provenance.sourceRepository !== 'https://github.com/abraxas914/GenericAgent') {
    fail('provenance source repository is incorrect');
  }
  if (provenance.sourceCommit !== expectedSourceCommit) fail('provenance source commit is incorrect');
  if (provenance.generatedAssetCount !== generatedFiles.length) {
    fail(`provenance asset count mismatch: expected ${provenance.generatedAssetCount}, found ${generatedFiles.length}`);
  }
  if (provenance.generatedManifestSha256 !== manifestDigest) {
    fail(`provenance manifest mismatch: expected ${provenance.generatedManifestSha256}, found ${manifestDigest}`);
  }
}

async function main() {
  const requiredFiles = [
    'index.html',
    'loading.html',
    'setup.html',
    'fallback.html',
    'assets/ga-logo.svg',
    'THIRD_PARTY_NOTICES.txt',
    'README.md',
    'build-provenance.json',
  ];
  await Promise.all(requiredFiles.map(assertExists));
  for (const deadAsset of removedLegacyAssets) {
    if (await exists(path.join(distDir, deadAsset))) {
      fail(`dead legacy React asset remains in compiled output: ${deadAsset}`);
    }
  }

  verifyTrackedSourceBoundary();
  await verifyNoticeAttributes();
  const files = await walk(distDir);
  const forbiddenSource = files.map(relativeToDist).filter((file) => /(?:\.map|\.tsx?|\.jsx)$/i.test(file));
  if (forbiddenSource.length > 0) fail(`compiled distribution contains source files: ${forbiddenSource.join(', ')}`);

  const searchableFiles = files.filter((file) => /\.(?:html|js|css)$/i.test(file));
  const searchableContents = [];
  for (const file of searchableFiles) {
    const contents = await readFile(file, 'utf8');
    searchableContents.push(contents);
    if (/(?:webdriverio|__GA_E2E__|wdio:|sourceMappingURL|webpack:\/\/|\/Users\/)/i.test(contents)) {
      fail(`compiled distribution leaks source/E2E material: ${relativeToDist(file)}`);
    }
  }
  const compiledRenderer = searchableContents.join('\n');
  for (const marker of [
    'services/capabilities',
    'data-import-row',
    'data-export-row',
    'get_macos_titlebar_metrics',
    'titlebar-controls',
  ]) {
    if (!compiledRenderer.includes(marker)) {
      fail(`compiled distribution is missing the v0.2.1 renderer contract: ${marker}`);
    }
  }

  const notice = await readFile(path.join(distDir, 'THIRD_PARTY_NOTICES.txt'));
  if (sha256(notice) !== expectedNoticeSha256) fail('Semi Design third-party notice hash is incorrect');
  const readme = await readFile(path.join(distDir, 'README.md'), 'utf8');
  for (const value of [
    expectedSourceCommit,
    ...semiPackages,
    'https://github.com/DouyinFE/semi-design',
    'https://semi.design',
    'Copyright (c) 2021 DouyinFE',
    'License: MIT',
    'THIRD_PARTY_NOTICES.txt',
    '5ddf03bb152666637bdfcfa44f1fac3cff5a66b6',
    '2fb55d944e4444b08cb9ad76c13aef7a5788186b',
    '3e7ca6a2b20eefdb3ee335dc0d520c3b6d9d57f8',
    'not a claim that later builds are bit-for-bit reproducible',
  ]) {
    if (!readme.includes(value)) fail(`compiled README is missing required provenance/license text: ${value}`);
  }

  await Promise.all(['index.html', 'loading.html', 'setup.html'].map(verifyHtmlReferences));
  await verifyVersionsRendererAndEntry();
  await verifyReleaseContract();
  await verifyGeneratedManifest(files);
  console.log('Compiled React Desktop 2.0 distribution contracts passed.');
}

await main();
