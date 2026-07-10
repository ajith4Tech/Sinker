"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

export function FileDropZone({
  files,
  onFilesChange,
  accept,
  multiple = true,
  label,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  accept: string;
  multiple?: boolean;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    onFilesChange(multiple ? [...files, ...Array.from(list)] : [list[0]]);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-primary bg-muted" : "border-border hover:bg-muted/50"
        )}
      >
        <UploadCloud className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">Click to browse or drag files here</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {files.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {files.map((file, i) => (
            <li key={i} className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5">
              <span className="truncate">{file.name}</span>
              <button
                className="ml-2 text-xs hover:text-destructive"
                onClick={() => onFilesChange(files.filter((_, index) => index !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
