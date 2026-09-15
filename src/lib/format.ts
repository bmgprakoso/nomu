export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FEED_TYPE_EMOJI: Record<string, string> = {
  formula: "🍼",
  breast_milk: "🥛",
  breastfeeding_direct: "🤱",
};

const FEED_TYPE_LABEL: Record<string, string> = {
  formula: "Formula",
  breast_milk: "ASI",
  breastfeeding_direct: "ASI langsung",
};

// For inline confirmations, e.g. "🍼 Formula".
export function describeFeedType(feedType: string): string {
  const emoji = FEED_TYPE_EMOJI[feedType] ?? "🍽️";
  const label = FEED_TYPE_LABEL[feedType] ?? feedType;
  return `${emoji} ${label}`;
}

// Plain label only (no emoji), for use inside monospace tables where
// variable-width emoji glyphs would break column alignment.
export function feedTypeTableLabel(feedType: string): string {
  return FEED_TYPE_LABEL[feedType] ?? feedType;
}

export function padTable(rows: string[][], header: string[]): string {
  const widths = header.map((h, col) =>
    Math.max(h.length, ...rows.map((r) => r[col].length)),
  );
  const renderRow = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();

  return [renderRow(header), ...rows.map(renderRow)].join("\n");
}
