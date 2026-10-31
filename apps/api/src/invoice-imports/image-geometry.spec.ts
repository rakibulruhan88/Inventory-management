import { createCanvas } from '@napi-rs/canvas';
import {
  detectInvoiceFrame,
  flattenPaperShading,
  rectifyInvoiceFrame,
} from './image-geometry.js';
import { removeCellEdgeRules } from './ocr-cell.js';

describe('photographed invoice geometry and ink preservation', () => {
  it('removes a dark paper gradient without deleting black text', () => {
    const canvas = createCanvas(500, 600),
      ctx = canvas.getContext('2d');
    for (let y = 0; y < 600; y++) {
      const gray = Math.round(245 - y * 0.2);
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(0, y, 500, 1);
    }
    ctx.fillStyle = 'black';
    ctx.fillRect(180, 450, 110, 25);
    flattenPaperShading(canvas);
    const pixels = ctx.getImageData(0, 0, 500, 600).data;
    expect(pixels[(462 * 500 + 225) * 4]).toBe(0);
    expect(pixels[(460 * 500 + 400) * 4]).toBeGreaterThan(240);
  });

  it('finds a tilted printed frame and keeps content outside it within the pixel limit', () => {
    const canvas = createCanvas(800, 1100),
      ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 800, 1100);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(40, 30);
    ctx.lineTo(760, 65);
    ctx.lineTo(740, 1040);
    ctx.lineTo(50, 1065);
    ctx.closePath();
    ctx.stroke();
    // A mark outside the printed border must survive the full-page transform.
    ctx.fillStyle = 'black';
    ctx.fillRect(380, 1080, 30, 8);
    const frame = detectInvoiceFrame(canvas);
    expect(frame).not.toBeNull();
    expect(frame![0].x).toBeCloseTo(40, -1);
    expect(frame![0].y).toBeCloseTo(30, -1);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 800, 1100);
    ctx.fillStyle = 'black';
    ctx.fillRect(380, 1080, 30, 8);
    const corrected = rectifyInvoiceFrame(canvas, frame!, 900000);
    expect(corrected.width * corrected.height).toBeLessThanOrEqual(900000);
    const pixels = corrected
      .getContext('2d')
      .getImageData(0, 0, corrected.width, corrected.height).data;
    let ink = 0;
    for (let y = 0; y < corrected.height; y++)
      for (let x = 0; x < corrected.width; x++)
        if (pixels[(y * corrected.width + x) * 4] < 100) ink++;
    expect(ink).toBeGreaterThan(10);
  });

  it('does not invent a frame in a blank or very dark image', () => {
    for (const color of ['white', 'black']) {
      const canvas = createCanvas(600, 800),
        ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 600, 800);
      expect(detectInvoiceFrame(canvas)).toBeNull();
    }
  });

  it('cleans slanted cell borders while retaining an isolated digit and near-edge lettering', () => {
    const canvas = createCanvas(320, 100),
      ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 320, 100);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, 10);
    ctx.lineTo(15, 90);
    ctx.stroke();
    ctx.fillStyle = 'black';
    ctx.fillRect(156, 34, 4, 32);
    ctx.fillRect(23, 38, 4, 24);
    removeCellEdgeRules(canvas, 10);
    const pixels = ctx.getImageData(0, 0, 320, 100).data;
    expect(pixels[(50 * 320 + 157) * 4]).toBe(0);
    expect(pixels[(45 * 320 + 24) * 4]).toBe(0);
    expect(pixels[(50 * 320 + 13) * 4]).toBe(255);
  });
});
