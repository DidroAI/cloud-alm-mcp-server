import { CloudAlmError } from "./calm/errors.js";

/** SAP may have accepted a mutation even though its response was lost. */
export class UnconfirmedWrite extends CloudAlmError {
  constructor(reason: string) { super("unavailable", reason); }
}

/** A receipt for the user when a write needs attention. One row per item or follow-up. */
export type WriteItemOutcome = {
  item: string;
  status: "written" | "unchanged" | "partial" | "failed" | "unconfirmed" | "skipped";
  detail: string;
};

export type WriteOutcome = { status: "partial" | "unconfirmed"; items: WriteItemOutcome[] };

export function writeResult(text: string, items: WriteItemOutcome[]) {
  if (items.every(row => row.status === "written" || row.status === "unchanged")) return text;
  const status = items.some(row => row.status === "written" || row.status === "partial") ? "partial" : "unconfirmed";
  // Replay keeps every item identifiable even when one provider explanation is long.
  const outcome: WriteOutcome = { status, items: items.map(row => ({
    ...row, item: clipped(row.item, 180), detail: clipped(row.detail, 600),
  })) };
  return { text, data: { outcome } };
}

const clipped = (text: string, max: number) => text.length <= max ? text : text.slice(0, max - 1) + "…";

export function writeFailure(item: string, error: unknown): WriteItemOutcome {
  const uncertain = !(error instanceof CloudAlmError) || error.code === "unavailable";
  return { item, status: uncertain ? "unconfirmed" : "failed",
    detail: error instanceof CloudAlmError ? error.reason : "Unexpected error. Check the item in Cloud ALM." };
}
