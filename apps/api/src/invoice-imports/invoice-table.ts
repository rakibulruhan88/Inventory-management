import type {
  DocumentLine,
  DocumentPage,
  DocumentSpan,
  DocumentCell,
} from './document-types.js';
import {
  columnRoles,
  findStructuralLabels,
  matchStructuralLabel,
  type StructuralRole,
} from './structural-labels.js';
export type InvoiceColumn = (typeof columnRoles)[number];
export type InvoiceCells = Partial<Record<InvoiceColumn, string>>;
export type InvoiceTableRow = {
  source: DocumentLine;
  cells: InvoiceCells;
  ambiguous: boolean;
  layout: 'POSITIONED' | 'DELIMITED' | 'UNAVAILABLE';
  header: boolean;
  confidence?: Partial<Record<InvoiceColumn, number>>;
  weak?: boolean;
};
const required: InvoiceColumn[] = [
  'item',
  'description',
  'color',
  'meter',
  'rolls',
];
type Anchor = {
  key: InvoiceColumn;
  center: number;
  left: number;
  height: number;
  line: number;
  fuzzy: boolean;
};
type Layout = {
  columns: { key: InvoiceColumn; left: number; right: number }[];
  headerLines: Set<number>;
  bottom: number;
  height: number;
  weak: boolean;
};
function locatedHeaders(line: DocumentLine): Anchor[] {
  if (!line.spans?.length) return [];
  let offset = 0;
  const ranges = line.spans.map((span) => {
    const start = offset;
    offset += span.text.length + 1;
    return { span, start, end: offset - 1 };
  });
  const text = line.spans.map((s) => s.text).join(' ');
  return findStructuralLabels(text, columnRoles, true).flatMap((match) => {
    const selected = ranges.filter(
      (r) => r.end > match.start && r.start < match.end,
    );
    if (
      !selected.length ||
      selected.some(
        (r) => findStructuralLabels(r.span.text, columnRoles).length > 1,
      )
    )
      return [];
    const left = Math.min(...selected.map((r) => r.span.x)),
      right = Math.max(...selected.map((r) => r.span.x + r.span.width));
    return [
      {
        key: match.role as InvoiceColumn,
        center: (left + right) / 2,
        left,
        height: Math.max(...selected.map((r) => r.span.height)),
        line: line.line,
        fuzzy: match.fuzzy,
      },
    ];
  });
}
function valueEvidence(
  key: InvoiceColumn,
  center: number,
  anchors: Anchor[],
  lines: DocumentLine[],
  bottom: number,
) {
  const sorted = [...anchors].sort((a, b) => a.center - b.center),
    i = sorted.findIndex((a) => a.key === key);
  const left = i > 0 ? (sorted[i - 1].center + center) / 2 : -Infinity,
    right =
      i < sorted.length - 1 ? (center + sorted[i + 1].center) / 2 : Infinity;
  const values = lines
    .filter((l) => (l.spans?.[0].y ?? -Infinity) > bottom)
    .slice(0, 20)
    .flatMap((l) =>
      (l.cellSpans ?? l.spans ?? [])
        .filter((s) => s.x >= left && s.x < right)
        .map((s) => s.text),
    );
  if (key === 'color')
    return values.filter((v) => /[A-Z0-9]+\s*#/i.test(v)).length >= 2;
  if (key === 'meter' || key === 'rolls')
    return (
      values.filter((v) =>
        (key === 'rolls' ? /^\d+$/ : /^\d+(?:[,.]\d+)*$/).test(v),
      ).length >= 2
    );
  if (key === 'description')
    return values.some((v) => /size|leather|mm/i.test(v));
  if (key === 'item') return values.length > 0 && values.length < lines.length;
  return values.length > 0;
}
function pageLayouts(lines: DocumentLine[]) {
  const layouts: Layout[] = [];
  for (const seed of lines) {
    if (!locatedHeaders(seed).some((a) => a.key === 'item')) continue;
    const height = Math.max(...seed.spans!.map((s) => s.height)),
      y = seed.spans![0].y;
    const band = lines.filter((l) =>
      l.spans?.some((s) => Math.abs(s.y - y) <= height * 2.5),
    );
    let found = band.flatMap(locatedHeaders);
    found = found.filter(
      (a) =>
        !found.some((b) => b !== a && a.key === b.key && !b.fuzzy && a.fuzzy),
    );
    found = found
      .filter((a, i) => found.findIndex((b) => b.key === a.key) === i)
      .sort((a, b) => a.center - b.center);
    if (
      found.length < 3 ||
      !found.some((a) => a.key === 'item') ||
      !found.some((a) => a.key === 'color')
    )
      continue;
    const bottom = Math.max(
      ...band
        .filter((l) => found.some((a) => a.line === l.line))
        .flatMap((l) => l.spans!.map((s) => s.y)),
    );
    const exact = found.filter((a) => !a.fuzzy).length;
    found = found.filter(
      (a) =>
        !a.fuzzy ||
        (exact >= 2 && valueEvidence(a.key, a.center, found, lines, bottom)),
    );
    if (found.some((a, i) => i > 0 && a.center - found[i - 1].center <= height))
      continue;
    const weak = !required.every((key) => found.some((a) => a.key === key));
    const columns = found.map((a, i) => ({
      key: a.key,
      left: i === 0 ? -Infinity : (found[i - 1].center + a.center) / 2,
      right:
        i === found.length - 1
          ? Infinity
          : (a.center + found[i + 1].center) / 2,
    }));
    if (seed.method === 'OCR' && !weak) {
      const data = lines
        .filter((l) => (l.spans?.[0].y ?? -Infinity) > bottom)
        .slice(0, 40);
      for (let i = 1; i < columns.length; i++) {
        const column = columns[i];
        const candidates = data.flatMap((l) => {
          const words = (l.cellSpans ?? l.spans ?? []).filter(
            (s) => s.x >= column.left && s.x < column.right,
          );
          const chosen =
            column.key === 'color'
              ? words.find((s) => /^[A-Z0-9]+\s*#/i.test(s.text))
              : column.key === 'meter' || column.key === 'rolls'
                ? words.find((s) => /^\d+(?:\.\d+)?$/.test(s.text))
                : words[0];
          return chosen ? [chosen.x] : [];
        });
        const clusters = candidates
          .map((x) => ({
            x,
            n: candidates.filter((v) => Math.abs(v - x) < height * 0.4).length,
          }))
          .sort((a, b) => b.n - a.n);
        if (clusters[0]?.n >= 2) {
          const left = clusters[0].x - height * 0.5;
          columns[i - 1].right = left;
          column.left = left;
        }
      }
    }
    layouts.push({
      columns,
      headerLines: new Set(found.map((a) => a.line)),
      bottom,
      height,
      weak,
    });
  }
  return layouts;
}
function confidence(spans: DocumentSpan[]) {
  const values = spans.flatMap((s) =>
    s.confidence === undefined ? [] : [s.confidence],
  );
  return values.length ? Math.min(...values) : undefined;
}
function cellsAt(line: DocumentLine, layout: Layout): InvoiceTableRow {
  const cells: InvoiceCells = {},
    conf: Partial<Record<InvoiceColumn, number>> = {};
  let ambiguous = layout.weak;
  for (const span of line.cellSpans ?? line.spans ?? []) {
    const c = layout.columns.find((c) => span.x >= c.left && span.x < c.right);
    if (!c) {
      ambiguous = true;
      continue;
    }
    if (
      Number.isFinite(c.left) &&
      Math.abs(span.x - c.left) < span.height * 0.15
    )
      ambiguous = true;
    if (c.key === 'item' && span.x + span.width > c.right) ambiguous = true;
    cells[c.key] = [cells[c.key], span.text].filter(Boolean).join(' ');
    if (span.confidence !== undefined)
      conf[c.key] = Math.min(conf[c.key] ?? 100, span.confidence);
  }
  return {
    source: line,
    cells,
    ambiguous,
    layout: 'POSITIONED',
    header: layout.headerLines.has(line.line),
    confidence: conf,
    weak: layout.weak,
  };
}
// Physically merged cells establish their own vertical ownership interval. A
// centered Item No. applies to all color cells inside that interval, never to
// a guessed number of following/preceding rows.
function gridRows(
  page: DocumentPage,
  lines: DocumentLine[],
): InvoiceTableRow[] | null {
  const all = page.cells;
  if (!all?.length) return null;
  for (const seed of all) {
    if (matchStructuralLabel(seed.text, ['item'], true)?.role !== 'item')
      continue;
    const headers = all
      .filter(
        (c) =>
          Math.abs(c.y - seed.y) < seed.height * 0.25 &&
          Math.abs(c.height - seed.height) < seed.height * 0.5,
      )
      .sort((a, b) => a.x - b.x);
    const roles = headers.map((c) =>
      matchStructuralLabel(c.text, columnRoles, true),
    );
    const exact = roles.filter((r) => r && !r.fuzzy).length;
    if (exact < 3 || !roles.some((r) => r?.role === 'color')) continue;
    const valuesBelow = (cell: DocumentCell) =>
      all.filter(
        (c) => Math.abs(c.x - cell.x) < 4 && c.y >= cell.y + cell.height,
      );
    for (let i = 0; i < roles.length; i++)
      if (roles[i]?.fuzzy) {
        const r = roles[i]!;
        const values = valuesBelow(headers[i]);
        if (
          (r.role === 'meter' || r.role === 'rolls') &&
          !values.some((v) => /^\d+(?:\.\d+)?$/.test(v.text))
        )
          roles[i] = null;
      }
    // One unknown numeric heading can be identified only with decimal Meter
    // evidence and an independently recognized integer Rolls neighbor.
    if (
      !roles.some((r) => r?.role === 'meter') &&
      roles.some((r) => r?.role === 'rolls')
    ) {
      const candidates = headers
        .map((c, i) => ({ c, i, v: valuesBelow(c) }))
        .filter(
          ({ i, v }) =>
            !roles[i] && v.filter((c) => /^\d+\.\d+$/.test(c.text)).length >= 2,
        );
      if (candidates.length === 1)
        roles[candidates[0].i] = { role: 'meter', fuzzy: true, score: 0.8 };
    }
    const weak = !required.every((key) => roles.some((r) => r?.role === key));
    const colorIndex = roles.findIndex((r) => r?.role === 'color'),
      colorHeader = headers[colorIndex];
    const headerY = seed.y + seed.height;
    const result: InvoiceTableRow[] = lines
      .filter((l) => (l.spans?.[0].y ?? Infinity) < seed.y)
      .map((source) => ({
        source,
        cells: {},
        ambiguous: true,
        layout: 'UNAVAILABLE',
        header: false,
      }));
    const source: DocumentLine = {
      text: headers.map((c) => c.text).join(' | '),
      page: page.page,
      line:
        lines.find((l) => l.spans?.some((s) => s.y >= seed.y && s.y <= headerY))
          ?.line ?? 1,
      method: page.method,
      spans: headers.flatMap((c) => c.spans),
    };
    result.push({
      source,
      cells: {},
      ambiguous: false,
      layout: 'POSITIONED',
      header: true,
      weak,
    });
    let previousItem: DocumentCell | undefined;
    for (const colorCell of valuesBelow(colorHeader).sort(
      (a, b) => a.y - b.y,
    )) {
      const mid = colorCell.y + colorCell.height / 2,
        cells: InvoiceCells = {},
        conf: Partial<Record<InvoiceColumn, number>> = {};
      let ambiguous = weak;
      const itemHeader = headers[roles.findIndex((r) => r?.role === 'item')];
      let itemCell: DocumentCell | undefined = all.find(
        (c) =>
          itemHeader &&
          Math.abs(c.x - itemHeader.x) < 4 &&
          c.y >= headerY &&
          mid >= c.y - 3 &&
          mid <= c.y + c.height + 3,
      );
      const rowSpans: DocumentSpan[] = [];
      headers.forEach((header, i) => {
        const role = roles[i]?.role as InvoiceColumn | undefined;
        if (!role) return;
        const candidates = all.filter(
          (c) =>
            Math.abs(c.x - header.x) < 4 &&
            c.y >= headerY &&
            mid >= c.y - 3 &&
            mid <= c.y + c.height + 3,
        );
        if (candidates.length !== 1) {
          ambiguous = true;
          return;
        }
        const cell = candidates[0];
        if (role === 'item') itemCell = cell;
        if (
          (role === 'item' || role === 'description') &&
          itemCell === previousItem
        )
          return;
        cells[role] = cell.text;
        const value = confidence(cell.spans);
        if (value !== undefined) conf[role] = value;
        rowSpans.push(...cell.spans);
      });
      previousItem = itemCell;
      const line: DocumentLine = {
        text: Object.values(cells).join(' | '),
        page: page.page,
        line:
          lines.find((l) =>
            l.spans?.some(
              (s) =>
                s.y >= colorCell.y && s.y <= colorCell.y + colorCell.height,
            ),
          )?.line ?? source.line,
        method: page.method,
        spans: rowSpans,
      };
      result.push({
        source: line,
        cells,
        confidence: conf,
        ambiguous,
        layout: 'POSITIONED',
        header: false,
        weak,
      });
    }
    return result;
  }
  return null;
}
export function invoiceTableRows(
  lines: DocumentLine[],
  pages?: DocumentPage[],
): InvoiceTableRow[] {
  const result: InvoiceTableRow[] = [];
  for (const page of [...new Set(lines.map((l) => l.page))]) {
    const pageLines = lines.filter((l) => l.page === page),
      geometry = pages?.find((p) => p.page === page);
    const grid = geometry && gridRows(geometry, pageLines);
    if (grid) {
      result.push(...grid);
      continue;
    }
    const layouts = pageLayouts(pageLines);
    let delimited: (InvoiceColumn | undefined)[] | null = null;
    for (const source of pageLines) {
      const explicit = source.text.includes('|')
        ? source.text.split('|').map((c) => c.trim())
        : null;
      const header = explicit?.map(
        (c) =>
          matchStructuralLabel(c, columnRoles, true)?.role as
            InvoiceColumn | undefined,
      );
      if (
        header &&
        explicit!.filter((c) => matchStructuralLabel(c, columnRoles)?.role)
          .length >= 2 &&
        required.every((key) => header.includes(key)) &&
        new Set(header.filter(Boolean)).size === header.filter(Boolean).length
      )
        delimited = header;
      const layout = layouts
        .filter(
          (l) =>
            l.headerLines.has(source.line) ||
            (source.spans?.[0].y ?? -Infinity) > l.bottom,
        )
        .at(-1);
      if (layout && source.spans?.length) {
        result.push(cellsAt(source, layout));
        continue;
      }
      if (header && header === delimited) {
        result.push({
          source,
          cells: {},
          ambiguous: false,
          layout: 'DELIMITED',
          header: true,
        });
        continue;
      }
      if (delimited && explicit && explicit.length <= delimited.length) {
        const cells: InvoiceCells = {};
        explicit.forEach((v, i) => {
          const key = delimited![i];
          if (key) cells[key] = v;
        });
        result.push({
          source,
          cells,
          ambiguous: false,
          layout: 'DELIMITED',
          header: false,
        });
      } else
        result.push({
          source,
          cells: {},
          ambiguous: true,
          layout: 'UNAVAILABLE',
          header: false,
        });
    }
  }
  return result;
}
