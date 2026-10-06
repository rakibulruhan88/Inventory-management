import type { DocumentRule } from './document-types.js';
export type CellBox = { x: number; y: number; width: number; height: number };
export function invoiceGridCells(
  rules: DocumentRule[],
  width: number,
  height: number,
): CellBox[] {
  const vertical = rules
    .filter((r) => r.x0 === r.x1 && r.y1 - r.y0 > height * 0.25)
    .sort((a, b) => a.x0 - b.x0);
  const edges: DocumentRule[] = [];
  for (const rule of vertical) {
    const existing = edges.find((edge) => Math.abs(edge.x0 - rule.x0) < 6);
    if (!existing) edges.push({ ...rule });
    else {
      existing.y0 = Math.min(existing.y0, rule.y0);
      existing.y1 = Math.max(existing.y1, rule.y1);
    }
  }
  if (edges.length < 6 || edges.length > 12) return [];
  const median = (values: number[]) =>
    values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const top = median(edges.map((r) => r.y0)),
    bottom = median(edges.map((r) => r.y1));
  if (
    bottom - top < height * 0.2 ||
    edges.at(-1)!.x0 - edges[0].x0 < width * 0.6
  )
    return [];
  const cells: CellBox[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const left = edges[i].x0,
      right = edges[i + 1].x0;
    const cuts = rules
      .filter(
        (r) =>
          r.y0 === r.y1 &&
          r.y0 >= top - 6 &&
          r.y0 <= bottom + 6 &&
          r.x0 <= left + 6 &&
          r.x1 >= right - 6,
      )
      .map((r) => r.y0)
      .sort((a, b) => a - b);
    const unique = cuts.filter((y, i) => !i || y - cuts[i - 1] > 6);
    for (let j = 0; j < unique.length - 1; j++)
      if (unique[j + 1] - unique[j] > 8)
        cells.push({
          x: left + 3,
          y: unique[j] + 3,
          width: right - left - 6,
          height: unique[j + 1] - unique[j] - 6,
        });
  }
  return cells.length <= 250 ? cells : [];
}
