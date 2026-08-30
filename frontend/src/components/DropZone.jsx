import { useRef, useState } from "react";

export default function DropZone({ accent = "blue", accept = ".csv", onFile, disabled = false }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const border = {
    blue: dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-blue-400",
    amber: dragging ? "border-amber-500 bg-amber-50" : "border-slate-300 hover:border-amber-400",
    emerald: dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:border-emerald-400",
  }[accent] || "border-slate-300";

  const handleFiles = (files) => {
    if (!files || !files.length || disabled) return;
    const file = files[0];
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      onFile(null, `Only .csv files are accepted (got '${file.name}')`);
      return;
    }
    onFile(file, null);
  };

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed p-6 text-center transition ${border} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <span className="text-sm font-medium text-slate-800">Drop CSV here</span>
      <span className="text-xs text-slate-500">or click to select</span>
    </div>
  );
}
