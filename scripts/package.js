// Builds release/HYPERSPACE-win32-x64 (Electron app + HyperCore.exe as a resource).
// Run with: node scripts/package.js   (build the core first: dotnet publish ... -o core/dist)
const { packager } = require('@electron/packager');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const core = path.join(root, 'core', 'dist', 'HyperCore.exe');
if (!fs.existsSync(core)) { console.error('missing core/dist/HyperCore.exe'); process.exit(1); }

packager({
  dir: root,
  name: 'HYPERSPACE',
  executableName: 'HYPERSPACE',
  platform: 'win32',
  arch: 'x64',
  out: path.join(root, 'release'),
  overwrite: true,
  icon: path.join(root, 'assets', 'icon.ico'),
  asar: { unpack: '**/hw.ps1' },
  extraResource: [core],
  appCopyright: 'HYPERSPACE',
  win32metadata: { CompanyName: 'HYPERSPACE', FileDescription: 'HYPERSPACE system shaman', ProductName: 'HYPERSPACE' },
  ignore: [/^\/core($|\/)/, /^\/release($|\/)/, /^\/scripts($|\/)/, /^\/HYPERSPACE\.bat$/, /\.pdb$/],
  prune: true,
}).then((paths) => console.log('built', paths.join(', '))).catch((e) => { console.error(e); process.exit(1); });
