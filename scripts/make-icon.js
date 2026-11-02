// Renders the HYPERSPACE sigil (flower of life + hexagram) and writes assets/icon.png + assets/icon.ico.
// Run with: electron scripts/make-icon.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const html = `<html><body style="margin:0;background:transparent"><canvas id="c" width="512" height="512"></canvas><script>
const c = document.getElementById('c'), x = c.getContext('2d'), T = Math.PI * 2;
x.translate(256, 256);
const bg = x.createRadialGradient(0, 0, 20, 0, 0, 250);
bg.addColorStop(0, '#032a12'); bg.addColorStop(1, '#000400');
x.fillStyle = bg; x.beginPath(); x.arc(0, 0, 246, 0, T); x.fill();
x.strokeStyle = '#00ff6e'; x.lineWidth = 10; x.shadowColor = '#00ff6e'; x.shadowBlur = 24;
x.beginPath(); x.arc(0, 0, 236, 0, T); x.stroke();
x.lineWidth = 7; x.shadowBlur = 16;
const r = 62;
const pts = [[0, 0]];
for (let i = 0; i < 6; i++) pts.push([Math.cos(i * T / 6) * r, Math.sin(i * T / 6) * r]);
for (const [px, py] of pts) { x.beginPath(); x.arc(px, py, r, 0, T); x.stroke(); }
x.strokeStyle = '#c6ff00'; x.lineWidth = 9; x.shadowColor = '#c6ff00';
for (const rot of [-Math.PI / 2, Math.PI / 2]) {
  x.beginPath();
  for (let i = 0; i <= 3; i++) { const a = rot + i * T / 3; i ? x.lineTo(Math.cos(a) * 190, Math.sin(a) * 190) : x.moveTo(Math.cos(a) * 190, Math.sin(a) * 190); }
  x.stroke();
}
x.fillStyle = '#eafff0'; x.shadowColor = '#00ff6e'; x.shadowBlur = 30;
x.beginPath(); x.arc(0, 0, 16, 0, T); x.fill();
</script></body></html>`;

// ICO container holding PNG-compressed images (supported since Windows Vista).
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const base = nativeImage.createFromBuffer(img.toPNG()).resize({ width: 512, height: 512, quality: 'best' });
  const out = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), base.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  const sizes = [256, 128, 64, 48, 32, 16];
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(sizes.map((s) => ({ size: s, buf: base.resize({ width: s, height: s, quality: 'best' }).toPNG() }))));
  console.log('icon written');
  app.quit();
});
