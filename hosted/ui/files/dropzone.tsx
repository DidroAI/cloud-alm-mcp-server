"use client";

import { Upload } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useState } from "react";
import { cn } from "../cn";

/**
 * Where files are dropped or chosen: a dashed area that lights up while a
 * file is dragged over it. Clicking or pressing Enter opens the file picker.
 */
export function Dropzone({
  onFiles,
  title = "Drop files here",
  hint = "or click to choose them",
  accept,
  multiple = true,
  disabled = false,
  compact = false,
  className,
}: {
  onFiles: (files: File[]) => void;
  title?: ReactNode;
  hint?: ReactNode;
  /** As on `<input type="file">`: ".pdf,.docx". */
  accept?: string | undefined;
  multiple?: boolean | undefined;
  disabled?: boolean | undefined;
  /** One line instead of a tall area. */
  compact?: boolean | undefined;
  className?: string | undefined;
}) {
  const id = useId();
  const [over, setOver] = useState(false);

  function take(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (files.length > 0 && !disabled)
      onFiles(multiple ? files : files.slice(0, 1));
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer.files);
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "relative flex cursor-pointer items-center justify-center border border-dashed text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-accent",
        compact ? "gap-2.5 px-4 py-3" : "flex-col gap-2 px-6 py-8",
        over
          ? "border-accent bg-accent-surface"
          : "border-border-strong bg-subtle hover:border-accent",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span
        className={cn(
          "grid place-items-center text-muted [&_svg]:size-4",
          compact ? "" : "size-9 border border-border bg-surface",
          over && "text-accent",
        )}
      >
        <Upload aria-hidden="true" />
      </span>
      <span className="flex flex-col">
        <span className="text-small font-medium text-ink">{title}</span>
        {hint ? <span className="text-caption text-muted">{hint}</span> : null}
      </span>
      <input
        id={id}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
    </label>
  );
}
