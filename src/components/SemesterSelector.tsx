import { useState, useRef, useEffect } from "react";
import { formatSemesterLabel } from "../lib/term";

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** 是否为正选/补退选视图（决定 2026-09 这类 TEST_SEMESTERS 是否带「（测试）」后缀）。 */
  isFormalView?: boolean;
}

// 自定义下拉，避免原生 <select> 在不同平台上观感差异和样式被锁死。
// 一定要选中其中一项 —— 不再提供"全部"，选课总是一学期一学期看。
export function SemesterSelector({ value, onChange, options, isFormalView = false }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const disabled = options.length === 0;
  const display = disabled ? "暂无数据" : value ? formatSemesterLabel(value, { isFormalView }) : "选择";

  return (
    <div className="inline-flex items-center gap-2 text-xs">
      <span className="text-gray-400">开课时间</span>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all select-none ${
            disabled
              ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed"
              : open
              ? "bg-red-50 border-red-300 text-red-700 shadow-sm shadow-red-100"
              : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:text-gray-900"
          }`}
        >
          <span className="tabular-nums">{display}</span>
          <svg
            className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""} ${disabled ? "text-gray-300" : "text-gray-400"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && !disabled && (
          <div
            role="listbox"
            className="absolute right-0 mt-1 min-w-[120px] bg-white border border-gray-100 rounded-lg shadow-lg shadow-gray-200/60 py-1 z-50 overflow-hidden"
          >
            {options.map((opt) => {
              const selected = opt === value;
              return (
                <button
                  key={opt}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs tabular-nums transition-colors flex items-center justify-between gap-2 ${
                    selected
                      ? "bg-red-50 text-red-600 font-semibold"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span>{formatSemesterLabel(opt, { isFormalView })}</span>
                  {selected && (
                    <svg className="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
