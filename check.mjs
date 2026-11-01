import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const readJson = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
let failures = 0;

console.log('\n=== Release metadata ===');
try {
    const pkg = readJson('package.json');
    const manifest = readJson('manifest.json');
    const lock = readJson('package-lock.json');
    const versions = readJson('versions.json');
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'Manifest version must be a release version');
    for (const [name, version] of [
        ['package.json', pkg.version],
        ['package-lock.json', lock.version],
        ['package-lock.json root package', lock.packages?.['']?.version],
    ]) {
        assert.equal(version, manifest.version, `${name} version differs from manifest.json`);
    }
    assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json compatibility entry is out of sync');
    assert.equal(pkg.devDependencies.obsidian, manifest.minAppVersion, 'Minimum Obsidian version must match the pinned SDK');
    assert.equal(lock.packages?.['node_modules/obsidian']?.version, pkg.devDependencies.obsidian, 'Locked Obsidian SDK is out of sync');
    console.log(`PASS: ${manifest.version}, Obsidian ${manifest.minAppVersion}`);
} catch (error) {
    console.error(error.message);
    failures++;
}

for (const [name, args] of [
    ['Static analysis (zero warnings)', ['run', 'lint']],
    ['Tests', ['test', '--', '--runInBand']],
    ['TypeScript and production build', ['run', 'build']],
]) {
    console.log(`\n=== ${name} ===`);
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (result.error || result.status !== 0) {
        console.error(`FAIL: ${name} (${result.error?.message ?? result.signal ?? `exit ${result.status}`})`);
        failures++;
    }
}

console.log(failures ? `\nFAILED: ${failures} check stage(s).` : '\nPASS: all checks.');
process.exitCode = failures ? 1 : 0;
