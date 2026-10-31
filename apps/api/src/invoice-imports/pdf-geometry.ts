import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  DocumentCell,
  DocumentRule,
  DocumentSpan,
} from './document-types.js';
import { invoiceGridCells } from './ocr-grid.js';

type Matrix = number[];
type OperatorList = { fnArray: number[]; argsArray: unknown[][] };
const identity = [1, 0, 0, 1, 0, 0];

// PDF.js 6 emits compact drawing commands (move/line/cubic/quadratic/close).
// Only painted, straight table rules qualify; clipping paths and glyph outlines
// never establish ownership. All geometry uses the same viewport as text.
export function pdfTableGeometry(
  list: OperatorList,
  viewport: { transform: number[]; width: number; height: number },
) {
  const rules: DocumentRule[] = [];
  const maxRuleThickness =
    1.5 *
    Math.max(
      Math.hypot(viewport.transform[0], viewport.transform[1]),
      Math.hypot(viewport.transform[2], viewport.transform[3]),
    );
  const stack: Matrix[] = [];
  let transform = [...identity],
    nonRuleContent = false;
  const add = (a: number[], b: number[]) => {
    const matrix = Util.transform(viewport.transform, transform);
    const point = ([x, y]: number[]) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
    ];
    const [x0, y0] = point(a),
      [x1, y1] = point(b);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    if (Math.abs(x0 - x1) < 0.5 && Math.abs(y1 - y0) > 8)
      rules.push({
        x0: (x0 + x1) / 2,
        x1: (x0 + x1) / 2,
        y0: Math.min(y0, y1),
        y1: Math.max(y0, y1),
      });
    else if (Math.abs(y0 - y1) < 0.5 && Math.abs(x1 - x0) > 8)
      rules.push({
        y0: (y0 + y1) / 2,
        y1: (y0 + y1) / 2,
        x0: Math.min(x0, x1),
        x1: Math.max(x0, x1),
      });
    else nonRuleContent = true;
  };
  if (list.fnArray.length > 100_000) return { rules, nonRuleContent: true };
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i],
      args = list.argsArray[i];
    if (op === OPS.save) stack.push([...transform]);
    else if (op === OPS.restore) transform = stack.pop() ?? [...identity];
    else if (op === OPS.transform)
      transform = Util.transform(transform, args as number[]);
    else if (op === OPS.constructPath) {
      const paint = args?.[0];
      if (paint === OPS.clip || paint === OPS.eoClip || paint === OPS.endPath)
        continue;
      const commands = (args[1] as ArrayLike<ArrayLike<number>>)?.[0];
      // Spreadsheet exporters often paint table rules as very thin filled
      // rectangles. Accept only one closed, axis-aligned rectangle, never a
      // background, an open path, a compound path or a glyph outline.
      if (paint === OPS.fill || paint === OPS.eoFill) {
        if (
          commands?.length === 13 &&
          commands[0] === 0 &&
          commands[3] === 1 &&
          commands[6] === 1 &&
          commands[9] === 1 &&
          commands[12] === 4
        ) {
          const points = [1, 4, 7, 10].map((i) => [
            commands[i],
            commands[i + 1],
          ]);
          const [a, b, c, d] = points;
          const rectangular =
            (a[1] === b[1] &&
              b[0] === c[0] &&
              c[1] === d[1] &&
              d[0] === a[0]) ||
            (a[0] === b[0] && b[1] === c[1] && c[0] === d[0] && d[1] === a[1]);
          const matrix = Util.transform(viewport.transform, transform);
          const length = (p: number[], q: number[]) =>
            Math.hypot(
              matrix[0] * (q[0] - p[0]) + matrix[2] * (q[1] - p[1]),
              matrix[1] * (q[0] - p[0]) + matrix[3] * (q[1] - p[1]),
            );
          const width = length(a, b),
            height = length(b, c);
          const thin = Math.min(width, height),
            long = Math.max(width, height);
          if (
            rectangular &&
            thin > 0 &&
            thin <= maxRuleThickness &&
            long >= 12 &&
            long / thin >= 20
          ) {
            const midpoint = (p: number[], q: number[]) => [
              (p[0] + q[0]) / 2,
              (p[1] + q[1]) / 2,
            ];
            if (width > height) add(midpoint(a, d), midpoint(b, c));
            else add(midpoint(a, b), midpoint(d, c));
            continue;
          }
        }
        nonRuleContent = true;
        continue;
      }
      if (paint !== OPS.stroke && paint !== OPS.closeStroke) {
        nonRuleContent = true;
        continue;
      }
      if (!commands || commands.length > 50_000) {
        nonRuleContent = true;
        continue;
      }
      let point: number[] | null = null,
        start: number[] | null = null;
      for (let j = 0; j < commands.length;) {
        const command = commands[j++];
        if (command === 0) {
          point = [commands[j++], commands[j++]];
          start = point;
        } else if (command === 1) {
          const next = [commands[j++], commands[j++]];
          if (point) add(point, next);
          point = next;
        } else if (command === 4) {
          if (point && start) add(point, start);
          point = start;
        } else if (command === 2 || command === 3) {
          j += command === 2 ? 6 : 4;
          point = null;
          nonRuleContent = true;
        } else {
          nonRuleContent = true;
          break;
        }
      }
    } else if (
      [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject,
        OPS.showText,
        OPS.showSpacedText,
      ].includes(op)
    )
      nonRuleContent = true;
    if (rules.length > 10_000) return { rules: [], nonRuleContent: true };
  }
  return { rules, nonRuleContent };
}

export function nativeTableCells(
  rules: DocumentRule[],
  spans: DocumentSpan[],
  width: number,
  height: number,
): DocumentCell[] {
  return invoiceGridCells(rules, width, height).map((box) => {
    const words = spans.filter(
      (span) =>
        span.x + span.width / 2 >= box.x - 3 &&
        span.x + span.width / 2 <= box.x + box.width + 3 &&
        span.y >= box.y - 3 &&
        span.y <= box.y + box.height + 3,
    );
    return {
      ...box,
      spans: words,
      text: words
        .map((span) => span.text)
        .join(' ')
        .trim(),
    };
  });
}
