import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { DocumentCell } from './document-types.js';

// Crop the entire ink extent, not an OCR word box: a missing digit has no word
// box and must still be visible to the second read. Table geometry owns the ROI.
export function cropCellInk(
  source: Canvas,
  box: Pick<DocumentCell, 'x' | 'y' | 'width' | 'height'>,
  options: { padding?: number } = {},
) {
  const left = Math.max(0, Math.floor(box.x)),
    top = Math.max(0, Math.floor(box.y));
  const width = Math.min(source.width - left, Math.ceil(box.width)),
    height = Math.min(source.height - top, Math.ceil(box.height));
  if (width < 1 || height < 1) return null;
  const pixels = source.getContext('2d').getImageData(left, top, width, height);
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (pixels.data[at + 3] > 128 && pixels.data[at] < 170) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  if (x1 < x0 || y1 < y0) return null;
  const inkWidth = x1 - x0 + 1,
    inkHeight = y1 - y0 + 1;
  const isolated = inkWidth < inkHeight * 0.8;
  // Oversizing an isolated "1" can make the LSTM discard it as a rule.
  const scale = isolated ? 1 : Math.min(3, Math.max(1, 48 / inkHeight)),
    padding = options.padding ?? (isolated ? 4 : 16);
  const canvas = createCanvas(
    Math.ceil(inkWidth * scale) + padding * 2,
    Math.ceil(inkHeight * scale) + padding * 2,
  );
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source,
    left + x0,
    top + y0,
    inkWidth,
    inkHeight,
    padding,
    padding,
    inkWidth * scale,
    inkHeight * scale,
  );
  return {
    canvas,
    scale,
    padding,
    x: left + x0,
    y: top + y0,
    inkWidth,
    inkHeight,
  };
}
