#!/usr/bin/env node
/**
 * Captures #heroVisual animation frames and assembles a GIF.
 * Usage: node scripts/capture-price-breakdown-gif.mjs
 * Requires: npx playwright, Python3 + Pillow
 */
import { chromium } from "playwright";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const framesDir = path.join(root, "assets", "_gif-frames");
const outGif = path.join(root, "assets", "price-breakdown-animation-phone.gif");
const url = "http://localhost:5500/price-breakdown-frame.html?record=1";

const FPS = 16;
const DURATION_MS = 6200; // full timeline ~4.5s + hold
const INTERVAL = 1000 / FPS;

fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 400, height: 460 },
  deviceScaleFactor: 2,
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__heroAnimReady === true);
await page.evaluate(() => document.fonts.ready);

const box = await page.locator("#heroVisual").boundingBox();
if (!box) throw new Error("#heroVisual not found");

const clip = {
  x: Math.round(box.x),
  y: Math.round(box.y),
  width: Math.round(box.width),
  height: Math.round(box.height),
};

await page.evaluate(() => window.__startHeroAnim());

const frameCount = Math.ceil(DURATION_MS / INTERVAL);
const t0 = Date.now();

for (let i = 0; i < frameCount; i++) {
  const target = t0 + i * INTERVAL;
  const wait = target - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const file = path.join(framesDir, `frame-${String(i).padStart(4, "0")}.png`);
  await page.screenshot({ path: file, clip, type: "png" });
  if (i % 16 === 0) process.stdout.write(`frame ${i}/${frameCount}\n`);
}

await browser.close();
process.stdout.write(`Captured ${frameCount} frames → assembling GIF…\n`);

const py = `
from PIL import Image
import os, glob

frames_dir = ${JSON.stringify(framesDir)}
out_gif = ${JSON.stringify(outGif)}
fps = ${FPS}

paths = sorted(glob.glob(os.path.join(frames_dir, "frame-*.png")))
imgs = []
for p in paths:
    im = Image.open(p).convert("RGBA")
    # Quantize per-frame for smaller GIF; keep palette diversity via adaptive
    bg = Image.new("RGBA", im.size, (241, 232, 218, 255))
    composed = Image.alpha_composite(bg, im).convert("RGB")
    q = composed.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
    imgs.append(q)

duration = int(1000 / fps)
imgs[0].save(
    out_gif,
    save_all=True,
    append_images=imgs[1:],
    duration=duration,
    loop=0,
    optimize=True,
    disposal=2,
)
print(out_gif)
print(f"frames={len(imgs)} size_mb={os.path.getsize(out_gif)/1e6:.2f}")
`;

const result = spawnSync("python3", ["-c", py], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(1);
}
console.log(result.stdout.trim());

// cleanup frames to save disk
fs.rmSync(framesDir, { recursive: true, force: true });
console.log("Done:", outGif);
