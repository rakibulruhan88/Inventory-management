import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfTableGeometry, nativeTableCells } from './pdf-geometry.js';
import { nativeTextUsable } from './document-reader.js';

const viewport = {
  transform: [2, 0, 0, -2, 0, 1000],
  width: 1200,
  height: 1000,
};
describe('PDF vector table geometry', () => {
  it('uses transformed painted rules and ignores clipping paths', () => {
    const commands = new Float32Array([
      0, 10, 20, 1, 200, 20, 0, 10, 20, 1, 10, 180,
    ]);
    const geometry = pdfTableGeometry(
      {
        fnArray: [
          OPS.save,
          OPS.transform,
          OPS.constructPath,
          OPS.restore,
          OPS.constructPath,
        ],
        argsArray: [
          [],
          [1, 0, 0, 1, 5, 10],
          [OPS.stroke, [commands]],
          [],
          [OPS.clip, [commands]],
        ],
      },
      viewport,
    );
    expect(geometry.rules).toEqual([
      { x0: 30, x1: 410, y0: 940, y1: 940 },
      { x0: 30, x1: 30, y0: 620, y1: 940 },
    ]);
    expect(geometry.nonRuleContent).toBe(false);
  });
  it('never treats images, curves or filled backgrounds as an empty page', () => {
    for (const list of [
      { fnArray: [OPS.paintImageXObject], argsArray: [[]] },
      {
        fnArray: [OPS.constructPath],
        argsArray: [[OPS.fill, [new Float32Array([0, 0, 0, 1, 10, 10])]]],
      },
      {
        fnArray: [OPS.constructPath],
        argsArray: [
          [OPS.stroke, [new Float32Array([0, 0, 0, 2, 1, 2, 3, 4, 5, 6])]],
        ],
      },
    ])
      expect(pdfTableGeometry(list, viewport).nonRuleContent).toBe(true);
  });
  it('retains row geometry in a wide native table with extra empty spreadsheet columns', () => {
    const rules = Array.from({ length: 16 }, (_, i) => ({
      x0: i * 70,
      x1: i * 70,
      y0: 100,
      y1: 900,
    }));
    rules.push(
      ...[100, 300, 500, 700, 900].map((y) => ({
        x0: 0,
        x1: 1050,
        y0: y,
        y1: y,
      })),
    );
    const cells = nativeTableCells(
      rules,
      [{ text: 'TEST2614', x: 10, y: 220, width: 40, height: 10 }],
      1200,
      1000,
    );
    expect(cells).toHaveLength(60);
    expect(cells.filter((c) => c.text)).toHaveLength(1);
  });
  it('uses OCR when native font text is corrupted even if headings survive', () => {
    expect(
      nativeTextUsable('1#Black 1502 41\nContract No.\n\ufffd\ufffd'),
    ).toBe(false);
  });
});
