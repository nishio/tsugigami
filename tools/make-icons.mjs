// アイコン PNG を依存なしで生成する。A4 を 2 枚縦に継ぎ、下の紙だけ右へ継ぎ足した図。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [36, 50, 79], PAPER = [245, 243, 236], INK = [36, 50, 79], MARK = [240, 196, 64];

function png(size) {
  const k = size / 512, px = new Uint8Array(size * size * 4);
  const rect = (x0, y0, x1, y1, c, a = 1) => {
    for (let y = Math.round(y0 * k); y < Math.round(y1 * k); y++)
      for (let x = Math.round(x0 * k); x < Math.round(x1 * k); x++) {
        const i = (y * size + x) * 4;
        for (let j = 0; j < 3; j++) px[i + j] = Math.round(px[i + j] * (1 - a) + c[j] * a);
        px[i + 3] = 255;
      }
  };
  rect(0, 0, 512, 512, BG);
  rect(104, 64, 328, 252, PAPER);          // 上の紙
  rect(104, 260, 328, 448, PAPER);         // 下の紙(継ぎ目 8)
  rect(336, 260, 424, 448, PAPER);         // 右に継いだ紙
  for (const [y, w] of [[104, 170], [140, 120], [176, 150], [212, 90]]) rect(132, y, 132 + w, y + 10, INK);
  rect(132, 296, 300, 318, MARK, .75);     // マーカー
  for (const [y, w] of [[304, 120], [340, 160], [376, 100], [412, 140]]) rect(140, y, 140 + w, y + 10, INK);
  for (const [y, w] of [[340, 56], [376, 40]]) rect(352, y, 352 + w, y + 10, INK);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) writeFileSync('public/icons/' + name, png(size));
console.log('icons written');
