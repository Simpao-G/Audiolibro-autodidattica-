// Genera le icone PNG dell'app a partire da public/icon.svg (da eseguire dopo aver modificato l'SVG):
//   node scripts/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const svg = fs.readFileSync(path.join(pub, 'icon.svg'), 'utf8');

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0, round: true },
  { file: 'icon-512.png', size: 512, pad: 0, round: true },
  // Maskable: sfondo pieno fino ai bordi e disegno ridotto nella zona sicura (80%)
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12, round: false },
  // iOS arrotonda da solo gli angoli: sfondo pieno
  { file: 'apple-touch-icon.png', size: 180, pad: 0, round: false },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const t of targets) {
    const inner = Math.round(t.size * (1 - t.pad * 2));
    const html = `<html><body style="margin:0;background:transparent">
      <div style="width:${t.size}px;height:${t.size}px;display:grid;place-items:center;
        background:${t.round ? 'transparent' : 'linear-gradient(160deg,#2e3d6e,#151b33)'}">
        <div style="width:${inner}px;height:${inner}px">${svg
          .replace('<svg ', `<svg width="${inner}" height="${inner}" `)
          // senza angoli arrotondati lo sfondo lo disegna il contenitore (bordi pieni)
          .replace(/<rect id="sfondo"[^>]*\/>/, t.round ? '$&' : '')}</div>
      </div></body></html>`;
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(html);
    await page.screenshot({ path: path.join(pub, t.file), omitBackground: t.round });
    console.log('creato', t.file);
  }
  await browser.close();
})();
