import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function RowList<T extends { id: string }>({
  rows,
  onAdd,
  onRemove,
  addLabel,
  render,
}: {
  rows: T[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  addLabel: string;
  render: (row: T, index: number) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={row.id} className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-display text-sm font-semibold tracking-wide text-muted-foreground">
              {index + 1}
            </span>
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-danger"
              aria-label="Remove row"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          {render(row, index)}
        </div>
      ))}
      <Button type="button" variant="outline" onClick={onAdd}>
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}
