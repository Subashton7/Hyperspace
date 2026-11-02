// Builds HyperCore.exe (the C# helper) for each processor type the installers ship for:
//   node scripts/build-core.js            -> x64 (also copied to core/dist/HyperCore.exe for `npm start`)
//   node scripts/build-core.js x64 arm64  -> both, into core/dist/x64 and core/dist/arm64
// Needs the .NET 8 SDK (dotnet on PATH, or the per-user install in %LOCALAPPDATA%\Microsoft\dotnet).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const arches = process.argv.slice(2).length ? process.argv.slice(2) : ['x64'];
const local = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet', 'dotnet.exe');
const dotnet = fs.existsSync(local) ? local : 'dotnet';

for (const arch of arches) {
  if (!['x64', 'arm64'].includes(arch)) { console.error(`unknown processor type: ${arch}`); process.exit(1); }
  const out = path.join(root, 'core', 'dist', arch);
  console.log(`HyperCore for ${arch} -> ${path.relative(root, out)}`);
  const r = spawnSync(dotnet, ['publish', 'core', '-c', 'Release', '-r', `win-${arch}`, '--self-contained', 'true',
    '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:PublishReadyToRun=true', '-o', out], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  if (arch === 'x64') fs.copyFileSync(path.join(out, 'HyperCore.exe'), path.join(root, 'core', 'dist', 'HyperCore.exe'));
}
