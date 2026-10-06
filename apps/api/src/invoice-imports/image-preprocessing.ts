import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DocumentReadError, type DocumentRule } from './document-types.js';

// A bounded raster transform, never a modification of the private original.
export async function preprocessInvoiceImage(
  bytes: Buffer,
  maxPixels: number,
  quarterTurns = 0,
) {
  let image = await loadImage(bytes);
  if (!image.width || !image.height || image.width * image.height > maxPixels)
    throw new DocumentReadError(
      'IMAGE_TOO_LARGE',
      'The image dimensions exceed the safe document limit.',
    );

  if (quarterTurns) {
    const quarterCanvas = createCanvas(
        quarterTurns % 2 ? image.height : image.width,
        quarterTurns % 2 ? image.width : image.height,
      ),
      qc = quarterCanvas.getContext('2d');
    qc.fillStyle = 'white';
    qc.fillRect(0, 0, quarterCanvas.width, quarterCanvas.height);
    qc.translate(quarterCanvas.width / 2, quarterCanvas.height / 2);
    qc.rotate((quarterTurns * Math.PI) / 2);
    qc.drawImage(image, -image.width / 2, -image.height / 2);
    image = await loadImage(quarterCanvas.toBuffer('image/png'));
    quarterCanvas.width = 1;
    quarterCanvas.height = 1;
  }
  const previewScale = Math.min(1, 500 / Math.max(image.width, image.height));
  const preview = createCanvas(
    Math.round(image.width * previewScale),
    Math.round(image.height * previewScale),
  );
  const pc = preview.getContext('2d');
  pc.fillStyle = 'white';
  pc.fillRect(0, 0, preview.width, preview.height);
  pc.drawImage(image, 0, 0, preview.width, preview.height);
  const pd = pc.getImageData(0, 0, preview.width, preview.height).data;
  const points: [number, number][] = [];
  for (let y = 0; y < preview.height; y++)
    for (let x = 0; x < preview.width; x++)
      if (pd[(y * preview.width + x) * 4] < 130)
        points.push([x - preview.width / 2, y - preview.height / 2]);
  const score = (angle: number) => {
    const radians = (angle * Math.PI) / 180,
      bins = new Uint32Array(preview.height + preview.width + 10);
    const shift = Math.floor(bins.length / 2);
    for (const [x, y] of points)
      bins[Math.round(y * Math.cos(radians) + x * Math.sin(radians)) + shift]++;
    return bins.reduce((sum, n) => sum + n * n, 0);
  };
  let angle = 0,
    best = score(0);
  const baseline = best;
  for (let candidate = -3; candidate <= 3; candidate += 0.25) {
    const value = score(candidate);
    if (value > best) {
      best = value;
      angle = candidate;
    }
  }
  if (best < baseline * 1.08) angle = 0;
  const radians = (angle * Math.PI) / 180;
  const rotatedWidth = Math.ceil(
    image.width * Math.cos(radians) +
      image.height * Math.abs(Math.sin(radians)),
  );
  const rotatedHeight = Math.ceil(
    image.height * Math.cos(radians) +
      image.width * Math.abs(Math.sin(radians)),
  );
  const scale = Math.min(
    3,
    Math.max(1, 2400 / image.width),
    Math.sqrt(maxPixels / (rotatedWidth * rotatedHeight)),
  );
  const width = Math.floor(rotatedWidth * scale),
    height = Math.floor(rotatedHeight * scale);
  if (width * height > maxPixels)
    throw new DocumentReadError(
      'IMAGE_TOO_LARGE',
      'The processed image exceeds the safe document limit.',
    );
  const canvas = createCanvas(width, height),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.rotate(radians);
  ctx.drawImage(
    image,
    (-image.width * scale) / 2,
    (-image.height * scale) / 2,
    image.width * scale,
    image.height * scale,
  );
  ctx.resetTransform();
  const data = ctx.getImageData(0, 0, width, height),
    pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2],
    );
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.08 + 128));
    pixels[i] = pixels[i + 1] = pixels[i + 2] = contrasted;
    pixels[i + 3] = 255;
  }
  const rules: DocumentRule[] = [];
  const scan = (vertical: boolean) => {
    const outer = vertical ? width : height,
      inner = vertical ? height : width;
    for (let o = 0; o < outer; o++) {
      let start = -1;
      for (let n = 0; n <= inner; n++) {
        const dark =
          n < inner &&
          pixels[(vertical ? n * width + o : o * width + n) * 4] < 170;
        if (dark && start < 0) start = n;
        if (!dark && start >= 0) {
          if (n - start > inner * (vertical ? 0.04 : 0.08))
            rules.push(
              vertical
                ? { x0: o, y0: start, x1: o, y1: n }
                : { x0: start, y0: o, x1: n, y1: o },
            );
          start = -1;
        }
      }
    }
  };
  scan(false);
  scan(true);
  // Remove only long straight rules after recording them. A margin of one
  // pixel removes antialiasing without aggressive thresholding of text.
  for (const rule of rules)
    for (
      let y = Math.max(0, rule.y0 - 1);
      y <= Math.min(height - 1, rule.y1 + 1);
      y++
    )
      for (
        let x = Math.max(0, rule.x0 - 1);
        x <= Math.min(width - 1, rule.x1 + 1);
        x++
      ) {
        const i = (y * width + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      }
  ctx.putImageData(data, 0, 0);
  // Collapse duplicate pixel-thick rules; retain relative physical cell edges.
  const merged: DocumentRule[] = [];
  for (const rule of rules) {
    const previous = merged.find(
      (r) =>
        (r.x0 === r.x1) === (rule.x0 === rule.x1) &&
        Math.abs(r.x0 - rule.x0) < 4 &&
        Math.abs(r.y0 - rule.y0) < 4 &&
        Math.abs(r.x1 - rule.x1) < 4 &&
        Math.abs(r.y1 - rule.y1) < 4,
    );
    if (!previous) merged.push(rule);
  }
  return {
    canvas,
    bytes: canvas.toBuffer('image/png'),
    width,
    height,
    rules: merged,
    rotationDegrees: angle,
    scale,
  };
}
