import type { RenameFile, RenameItemStatus, SingleExecuteItem, StorageLocation } from "../../types";

interface RenameRecordTarget {
  before: Readonly<Pick<RenameFile, "id" | "name">>;
  targetName: string;
}

type RenameRecordItem = RenameRecordTarget & {
  status: RenameItemStatus;
  after: RenameFile | null;
  actualName: string | null;
  error: string | null;
  errorCode?: SingleExecuteItem["error_code"];
  details?: SingleExecuteItem["details"];
};

export interface RenameSubmission {
  operationId: string;
  kind: "single" | "batch";
  storageId: string;
  revision: number;
  location: StorageLocation;
  items: readonly RenameRecordTarget[];
}

export type PendingRenameRecord = Readonly<RenameSubmission & { submittedAt: number }>;
export type RenameRecord = Omit<PendingRenameRecord, "items"> & {
  readonly items: readonly Readonly<RenameRecordItem>[];
};

export function finishRenameRecord(record: PendingRenameRecord, outcomes: readonly SingleExecuteItem[]): RenameRecord {
  const byId = new Map(outcomes.map((item) => [item.file_id, item]));
  return { ...record, items: record.items.map((item) => {
    const outcome = byId.get(item.before.id);
    return {
      ...item, status: outcome?.status ?? "unknown",
      after: outcome?.current_file ? structuredClone(outcome.current_file) : null,
      actualName: outcome?.actual_name ?? null, error: outcome?.error ?? null,
      errorCode: outcome?.error_code, details: outcome?.details,
    };
  }) };
}
