import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { DocumentRule } from './document-types.js';

type Point = { x: number; y: number };
type Line = {
  slope: number;
  offset: number;
  start: number;
  end: number;
  support: number;
};
export type InvoiceFrame = [Point, Point, Point, Point];

// Local paper brightness, rather than a fixed dark-pixel threshold, keeps
// camera shadows from becoming solid black regions or false table rules.
export function flattenPaperShading(canvas: Canvas) {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;
  // 16 million pixels * 255 fits in Uint32; keep worker memory bounded.
  const sums = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += pixels[(y * width + x) * 4];
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
    }
  }
  const radius = Math.max(12, Math.round(Math.max(width, height) / 75));
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius),
      bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius),
        right = Math.min(width, x + radius + 1);
      const mean =
        (sums[bottom * (width + 1) + right] -
          sums[top * (width + 1) + right] -
          sums[bottom * (width + 1) + left] +
          sums[top * (width + 1) + left]) /
        ((right - left) * (bottom - top));
      const i = (y * width + x) * 4;
      const value = Math.min(
        255,
        Math.round((pixels[i] * 255) / Math.max(80, mean)),
      );
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function longLines(
  points: Point[],
  width: number,
  height: number,
  vertical: boolean,
  grid = false,
): Line[] {
  const axis = vertical ? height : width,
    cross = vertical ? width : height;
  const shift = Math.ceil(axis * 0.18) + 4;
  const candidates: { slope: number; offset: number; votes: number }[] = [];
  for (let degrees = -8; degrees <= 8; degrees += 0.25) {
    const slope = Math.tan((degrees * Math.PI) / 180);
    const bins = new Uint32Array(cross + shift * 2 + 2);
    for (const point of points) {
      const along = vertical ? point.y : point.x,
        across = vertical ? point.x : point.y;
      bins[Math.round(across - slope * along) + shift]++;
    }
    for (let i = 1; i < bins.length - 1; i++)
      if (
        bins[i] >= axis * (grid ? 0.22 : 0.48) &&
        bins[i] >= bins[i - 1] &&
        bins[i] >= bins[i + 1]
      )
        candidates.push({ slope, offset: i - shift, votes: bins[i] });
  }
  candidates.sort((a, b) => b.votes - a.votes);
  const lines: Line[] = [];
  for (const candidate of candidates.slice(0, grid ? 500 : 160)) {
    if (
      lines.some(
        (line) =>
          Math.abs(
            line.offset +
              (line.slope * axis) / 2 -
              candidate.offset -
              (candidate.slope * axis) / 2,
          ) < 5,
      )
    )
      continue;
    const occupied = new Uint8Array(axis);
    for (const point of points) {
      const along = vertical ? point.y : point.x,
        across = vertical ? point.x : point.y;
      if (
        Math.abs(across - candidate.slope * along - candidate.offset) <=
        (grid ? 3 : 1.5)
      )
        occupied[along] = 1;
    }
    const support = occupied.reduce((sum, value) => sum + value, 0);
    let start = occupied.indexOf(1),
      end = occupied.lastIndexOf(1);
    if (grid) {
      let first = -1,
        last = -1,
        bestStart = -1,
        bestEnd = -1;
      for (let i = 0; i <= occupied.length; i++) {
        if (occupied[i]) {
          if (first < 0) first = i;
          last = i;
        } else if (first >= 0 && i - last > 3) {
          if (last - first > bestEnd - bestStart) {
            bestStart = first;
            bestEnd = last;
          }
          first = -1;
        }
      }
      if (last - first > bestEnd - bestStart && first >= 0) {
        bestStart = first;
        bestEnd = last;
      }
      start = bestStart;
      end = bestEnd;
    }
    if (
      support < axis * (grid ? 0.25 : 0.55) ||
      end - start < axis * (grid ? 0.25 : 0.65)
    )
      continue;
    lines.push({
      slope: candidate.slope,
      offset: candidate.offset,
      start,
      end,
      support,
    });
  }
  return lines;
}

export function detectInvoiceRules(
  canvas: Canvas,
): (DocumentRule & { stroke: DocumentRule })[] {
  const scale = Math.min(1, 1400 / Math.max(canvas.width, canvas.height));
  const preview = createCanvas(
    Math.round(canvas.width * scale),
    Math.round(canvas.height * scale),
  );
  const ctx = preview.getContext('2d');
  ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
  const { width, height } = preview;
  const pixels = ctx.getImageData(0, 0, width, height).data,
    points: Point[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (pixels[(y * width + x) * 4] < 225) points.push({ x, y });
  preview.width = 1;
  preview.height = 1;
  if (points.length > width * height * 0.35) return [];
  const rules: (DocumentRule & { stroke: DocumentRule })[] = [];
  for (const vertical of [false, true]) {
    for (const line of longLines(points, width, height, vertical, true)) {
      if (Math.abs(line.slope) > Math.tan((0.5 * Math.PI) / 180)) continue;
      const across =
        (line.offset + (line.slope * (line.start + line.end)) / 2) / scale;
      const start = line.start / scale,
        end = line.end / scale;
      const first = (line.offset + line.slope * line.start) / scale,
        last = (line.offset + line.slope * line.end) / scale;
      if (vertical)
        rules.push({
          x0: Math.round(across),
          x1: Math.round(across),
          y0: Math.round(start),
          y1: Math.round(end),
          stroke: { x0: first, y0: start, x1: last, y1: end },
        });
      else
        rules.push({
          x0: Math.round(start),
          x1: Math.round(end),
          y0: Math.round(across),
          y1: Math.round(across),
          stroke: { x0: start, y0: first, x1: end, y1: last },
        });
    }
  }
  return rules;
}

export function eraseInvoiceRules(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  rules: DocumentRule[],
) {
  const thickness = Math.max(3, Math.round(Math.max(width, height) / 500));
  for (const rule of rules) {
    const vertical = Math.abs(rule.y1 - rule.y0) > Math.abs(rule.x1 - rule.x0);
    const start = Math.ceil(vertical ? rule.y0 : rule.x0),
      end = Math.floor(vertical ? rule.y1 : rule.x1);
    const from = vertical ? rule.x0 : rule.y0,
      to = vertical ? rule.x1 : rule.y1;
    const cross = vertical ? width : height,
      along = vertical ? height : width;
    let previous: number | undefined;
    for (let at = Math.max(0, start); at <= Math.min(along - 1, end); at++) {
      const expected =
        from + ((to - from) * (at - start)) / Math.max(1, end - start);
      const center =
        previous !== undefined && Math.abs(previous - expected) < 14
          ? previous
          : expected;
      const low = Math.max(0, Math.floor(center - 12)),
        high = Math.min(cross - 1, Math.ceil(center + 12));
      const index = (v: number) =>
        (vertical ? at * width + v : v * width + at) * 4;
      let best: { left: number; right: number; distance: number } | undefined;
      for (let v = low; v <= high; v++) {
        if (pixels[index(v)] >= 210) continue;
        const left = v;
        while (v <= high && pixels[index(v)] < 210) v++;
        const right = v - 1,
          distance = Math.abs((left + right) / 2 - center);
        if (
          right - left + 1 <= thickness &&
          (!best || distance < best.distance)
        )
          best = { left, right, distance };
      }
      if (!best) continue;
      previous = (best.left + best.right) / 2;
      for (
        let v = Math.max(0, best.left - 1);
        v <= Math.min(cross - 1, best.right + 1);
        v++
      ) {
        const i = index(v);
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      }
    }
  }
}

function intersection(horizontal: Line, vertical: Line): Point {
  const x =
    (vertical.offset + vertical.slope * horizontal.offset) /
    (1 - vertical.slope * horizontal.slope);
  return { x, y: horizontal.offset + horizontal.slope * x };
}

export function detectInvoiceFrame(canvas: Canvas): InvoiceFrame | null {
  const scale = Math.min(1, 1100 / Math.max(canvas.width, canvas.height));
  const preview = createCanvas(
    Math.round(canvas.width * scale),
    Math.round(canvas.height * scale),
  );
  const ctx = preview.getContext('2d');
  ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
  const { width, height } = preview;
  const data = ctx.getImageData(0, 0, width, height).data;
  const points: Point[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4] < 225) points.push({ x, y });
  preview.width = 1;
  preview.height = 1;
  if (points.length > width * height * 0.35) return null;
  const vertical = longLines(points, width, height, true).sort(
    (a, b) =>
      a.offset + (a.slope * height) / 2 - b.offset - (b.slope * height) / 2,
  );
  const horizontal = longLines(points, width, height, false).sort(
    (a, b) =>
      a.offset + (a.slope * width) / 2 - b.offset - (b.slope * width) / 2,
  );
  if (vertical.length < 2 || horizontal.length < 2) return null;
  const left = vertical[0],
    right = vertical.at(-1)!,
    top = horizontal[0],
    bottom = horizontal.at(-1)!;
  const corners: InvoiceFrame = [
    intersection(top, left),
    intersection(top, right),
    intersection(bottom, right),
    intersection(bottom, left),
  ];
  if (
    corners.some(
      (p) =>
        !Number.isFinite(p.x + p.y) ||
        p.x < -3 ||
        p.y < -3 ||
        p.x > width + 3 ||
        p.y > height + 3,
    )
  )
    return null;
  const [tl, tr, br, bl] = corners;
  // Only a nearly full-page printed frame is eligible. A partial table must
  // not crop away supplier, contract, date or totals outside that table.
  if (
    Math.max(tl.y, tr.y) > height * 0.18 ||
    Math.min(bl.y, br.y) < height * 0.82 ||
    Math.max(tl.x, bl.x) > width * 0.18 ||
    Math.min(tr.x, br.x) < width * 0.82
  )
    return null;
  return corners.map((p) => ({
    x: p.x / scale,
    y: p.y / scale,
  })) as InvoiceFrame;
}

export function rectifyInvoiceFrame(
  canvas: Canvas,
  corners: InvoiceFrame,
  maxPixels: number,
) {
  const [p0, p1, p2, p3] = corners;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const rawWidth = Math.max(distance(p0, p1), distance(p3, p2));
  const rawHeight = Math.max(distance(p0, p3), distance(p1, p2));
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant,
    h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const a = p1.x - p0.x + g * p1.x,
    b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y,
    e = p3.y - p0.y + h * p3.y;
  const inverse = (x: number, y: number) => {
    const denominator =
      (d * h - e * g) * x + (b * g - a * h) * y + a * e - b * d;
    return {
      u:
        ((e - p0.y * h) * x + (p0.x * h - b) * y + b * p0.y - p0.x * e) /
        denominator,
      v:
        ((p0.y * g - d) * x + (a - p0.x * g) * y + p0.x * d - a * p0.y) /
        denominator,
    };
  };
  const bounds = [
    [0, 0],
    [canvas.width, 0],
    [canvas.width, canvas.height],
    [0, canvas.height],
  ].map(([x, y]) => inverse(x, y));
  const minU = Math.min(...bounds.map((p) => p.u)),
    maxU = Math.max(...bounds.map((p) => p.u));
  const minV = Math.min(...bounds.map((p) => p.v)),
    maxV = Math.max(...bounds.map((p) => p.v));
  // Retain the whole photographed page, including text outside the printed frame.
  const fullWidth = rawWidth * (maxU - minU),
    fullHeight = rawHeight * (maxV - minV);
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / ((fullWidth + 32) * (fullHeight + 32))),
  );
  const width = Math.floor(fullWidth * scale),
    height = Math.floor(fullHeight * scale),
    margin = 8;
  const output = createCanvas(width + margin * 2, height + margin * 2);
  const ctx = output.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, output.width, output.height);
  const pixels = ctx.getImageData(0, 0, output.width, output.height);
  const input = canvas
    .getContext('2d')
    .getImageData(0, 0, canvas.width, canvas.height).data;
  for (let y = 0; y < output.height; y++)
    for (let x = 0; x < output.width; x++) {
      const u = minU + ((x - margin) / width) * (maxU - minU),
        v = minV + ((y - margin) / height) * (maxV - minV);
      const denominator = g * u + h * v + 1;
      const sx = (a * u + b * v + p0.x) / denominator,
        sy = (d * u + e * v + p0.y) / denominator;
      const ix = Math.floor(sx),
        iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix >= canvas.width - 1 || iy >= canvas.height - 1)
        continue;
      const fx = sx - ix,
        fy = sy - iy,
        index = (iy * canvas.width + ix) * 4;
      const gray = Math.round(
        input[index] * (1 - fx) * (1 - fy) +
          input[index + 4] * fx * (1 - fy) +
          input[index + canvas.width * 4] * (1 - fx) * fy +
          input[index + canvas.width * 4 + 4] * fx * fy,
      );
      const target = (y * output.width + x) * 4;
      pixels.data[target] =
        pixels.data[target + 1] =
        pixels.data[target + 2] =
          gray;
    }
  ctx.putImageData(pixels, 0, 0);
  return output;
}
