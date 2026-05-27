import { useState, useRef, useMemo, useEffect } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** 挂载即展开浮层（内联编辑场景）。 */
  autoOpen?: boolean;
  /** 挂载时预填的搜索词（内联编辑时填专业名，把同专业各变体一次列出）。 */
  seedQuery?: string;
  /** 主题色：默认站点红；学号导入处传 indigo 与该功能配色统一。 */
  accent?: "red" | "indigo";
}

// 完整类名（Tailwind JIT 需扫到完整字符串，不能动态拼接）。
const ACCENT = {
  red: { focus: "focus:border-red-300 focus:ring-red-50", item: "bg-red-50 text-red-600" },
  indigo: { focus: "focus:border-indigo-300 focus:ring-indigo-50", item: "bg-indigo-50 text-indigo-600" },
} as const;

// 一次最多渲染的候选数：放宽到 200，让滚动条能滚更多项；仍保留上限以兜底超长列表的性能与「剩余项」提示。
const MAX_VISIBLE = 200;

// 字符匹配度打分：完全相等 > 前缀 > 子串靠前 > 子串；长度越接近 query 越高。负无穷 = 不匹配。
function matchScore(option: string, q: string): number {
  const o = option.toLowerCase();
  const idx = o.indexOf(q);
  if (idx < 0) return -Infinity;
  let base: number;
  if (o === q) base = 1000;
  else if (o.startsWith(q)) base = 600;
  else base = 300 - idx;
  return base - (o.length - q.length) * 0.5;
}

/**
 * 培养方案搜索式 combobox：
 * - 输入框聚焦/输入时浮层显示匹配项
 * - 包含子串匹配（不区分大小写）
 * - 候选过多时只渲染前 MAX_VISIBLE 项
 * - 点击候选 / 按下 Enter 选中
 * - 上下方向键移动高亮项
 */
export function PlanSelector({ value, onChange, options, autoOpen = false, seedQuery, accent = "red" }: Props) {
  const a = ACCENT[accent];
  const [query, setQuery] = useState(autoOpen && seedQuery ? seedQuery : "");
  const [open, setOpen] = useState(autoOpen);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 挂载即展开（内联编辑）：聚焦输入框，方便直接搜索/改。
  useEffect(() => {
    if (autoOpen) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 已选 plan 同步到输入框（未聚焦时输入框显示完整 value）
  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_VISIBLE);
    // 子串匹配 + 按字符匹配度排序，重合度最高者置顶。
    return options
      .map((o) => [o, matchScore(o, q)] as const)
      .filter(([, s]) => s > -Infinity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_VISIBLE)
      .map(([o]) => o);
  }, [query, options]);

  const totalMatched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.length;
    return options.filter((o) => o.toLowerCase().includes(q)).length;
  }, [query, options]);

  // 点外面关闭浮层
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, value]);

  function commit(v: string) {
    onChange(v);
    setQuery(v);
    setOpen(false);
    inputRef.current?.blur();
  }

  function clear() {
    onChange("");
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        commit(filtered[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(value);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索 年级-专业"
          className={`w-full pl-3 pr-8 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700 placeholder-gray-400 outline-none focus:bg-white focus:ring-2 transition-all ${a.focus}`}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="清空选择"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto rounded-lg bg-white border border-gray-200 shadow-lg z-50">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">无匹配方案</div>
          ) : (
            <>
              {filtered.map((opt, i) => (
                <button
                  key={opt}
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => commit(opt)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    i === activeIdx ? a.item : "text-gray-700 hover:bg-gray-50"
                  } ${opt === value ? "font-semibold" : ""}`}
                >
                  {opt}
                </button>
              ))}
              {totalMatched > MAX_VISIBLE && (
                <div className="sticky bottom-0 px-3 py-2 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-100">
                  已显示前 {MAX_VISIBLE} 项，还有 {totalMatched - MAX_VISIBLE} 项未显示 · 输入更多文字（如专业名）以缩小范围…
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
