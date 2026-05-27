import { useState, useMemo, useRef, useEffect } from "react";
import type { Course, FormalSection } from "../../types";
import type { CreditPlanView } from "../../lib/creditPlan";
import { enrollYear, termToCalLabel } from "../../lib/term";
import { buildPlacement } from "../../lib/schedulePlacement";
import { copyText } from "../../lib/clipboard";
import { encodeBundle, decodeBundle, shareUrlOf, type PlanBundle } from "../../lib/planShare";
import { CreditRing, CreditRingLegend, FutureRequiredToggle } from "./CreditRing";
import { CreditBar } from "./CreditBar";
import { CartList } from "./CartList";
import { SimScheduleGrid } from "./SimScheduleGrid";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  view: CreditPlanView;
  cartCourses: Course[];
  selectedPlan: string;
  term: number;
  formalSections: FormalSection[];
  chosen: Record<string, string>;
  onChooseSection: (cid: string, optionKey: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onEditEarned: () => void;
  /** 取消/恢复本学期必修（toggle excludedRequired）。 */
  onCancelRequired: (cid: string) => void;
  /** 点击待选清单课程（无开课班级时）→ 预选课程详情。 */
  onSelectCourse: (course: Course) => void;
  /** 点击待选清单课程（已落格）→ 对应班级 section 详情。 */
  onSelectSection: (section: FormalSection) => void;
  /** 当前详情页打开的课程号（用于待选清单高亮已选中）。 */
  selectedCourseId?: string | null;
  /** 当前 StoredInputs（credit.stored）——保存方案时打包。 */
  inputs: Record<string, unknown>;
  /** 应用一个分享码解码后的 bundle。 */
  onApplyBundle: (bundle: PlanBundle) => void;
  /** 显示未来学期必修课开关（毕业核算环图浅蓝；与引导共享持久化）。 */
  showFutureRequired: boolean;
  setShowFutureRequired: (v: boolean) => void;
}

const JWXT_URL = "https://xk.jxnu.edu.cn/";
const RING = 64; // 悬浮按钮直径
const POS_KEY = "jxnu.sim.ringPos";

type Tab = "cart" | "schedule" | "credit";
const TABS: { key: Tab; label: string }[] = [
  { key: "cart", label: "待选清单" },
  { key: "schedule", label: "周课表" },
  { key: "credit", label: "毕业核算" },
];

interface Pos { x: number; y: number }

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.x === "number" && typeof p.y === "number") return p;
    }
  } catch {}
  return null;
}

// 默认放在右侧竖直居中（比贴角更显眼），用户可拖动。
function defaultPos(w: number, h: number): Pos {
  return { x: w - RING - 24, y: Math.round(h / 2 - RING / 2) };
}

// 右下角悬浮圆环「本学期 X/30」，可拖动 + 点开展开面板。圆环填充 = 本学期已规划 / 30，超限标红。
export function SimPanel({
  view, cartCourses, selectedPlan, term, formalSections, chosen, onChooseSection,
  onRemove, onClear, onEditEarned, onCancelRequired, onSelectCourse, onSelectSection,
  selectedCourseId, inputs, onApplyBundle, showFutureRequired, setShowFutureRequired,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("cart");
  const [hint, setHint] = useState(true); // 进入模拟选课时的位置提示
  const [reqOpen, setReqOpen] = useState(false); // 待选清单里「本学期必修」折叠保护（默认折叠）
  const [requiredCopiedId, setRequiredCopiedId] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<{ cid: string; name: string } | null>(null);
  const requestCancelRequired = (cid: string, name: string) => setPendingCancel({ cid, name });
  const [notice, setNotice] = useState<string | null>(null); // 轻提示（复制 / 桩功能）
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 方案分享 —— 把当前 plan + 已修输入 + cart + 选班 打成一段自包含码，复制 / 粘贴恢复。
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCode, setShareCode] = useState<string>("");
  const [pasteCode, setPasteCode] = useState<string>("");
  const [shareBusy, setShareBusy] = useState(false);
  const notify = (msg: string) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 1600);
  };

  // 保存当前方案为分享码：用 selectedPlan + inputs + cart cids + chosen 打包。
  const handleSaveBundle = async () => {
    if (!selectedPlan) {
      notify("请先选择培养方案再保存");
      return;
    }
    setShareBusy(true);
    try {
      const bundle: PlanBundle = {
        v: 1,
        plan: selectedPlan,
        inputs,
        cart: cartCourses.map((c) => c.id),
        chosen,
      };
      const code = await encodeBundle(bundle);
      setShareCode(code);
    } catch {
      notify("生成失败，请重试");
    } finally {
      setShareBusy(false);
    }
  };

  const handleCopyCode = async () => {
    if (!shareCode) return;
    const ok = await copyText(shareCode);
    notify(ok ? "已复制分享码" : "复制失败");
  };

  const handleCopyLink = async () => {
    if (!shareCode) return;
    const ok = await copyText(shareUrlOf(shareCode));
    notify(ok ? "已复制分享链接" : "复制失败");
  };

  const handleApplyPaste = async () => {
    const code = pasteCode.trim();
    if (!code) return;
    setShareBusy(true);
    const bundle = await decodeBundle(code);
    setShareBusy(false);
    if (!bundle) {
      notify("分享码无效或已损坏");
      return;
    }
    const cartCount = bundle.cart.length;
    if (!window.confirm(
      `将导入方案「${bundle.plan}」（待选 ${cartCount} 门），覆盖当前数据。继续吗？`,
    )) return;
    onApplyBundle(bundle);
    setPasteCode("");
    setShareOpen(false);
    notify("方案已恢复");
  };
  const [vp, setVp] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  const [pos, setPos] = useState<Pos>(() => loadPos() ?? defaultPos(vp.w, vp.h));
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);

  // 进入后 4s 自动收起位置提示。
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 4000);
    return () => clearTimeout(t);
  }, []);

  // 视口变化 → 跟踪 + 把圆环夹回屏内。
  useEffect(() => {
    const onR = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  useEffect(() => {
    setPos((p) => ({ x: clamp(p.x, 8, vp.w - RING - 8), y: clamp(p.y, 8, vp.h - RING - 8) }));
  }, [vp.w, vp.h]);
  useEffect(() => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
  }, [pos]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const ddx = e.clientX - d.px;
    const ddy = e.clientY - d.py;
    if (!d.moved && Math.hypot(ddx, ddy) > 4) d.moved = true;
    if (d.moved) {
      setPos({ x: clamp(d.ox + ddx, 8, vp.w - RING - 8), y: clamp(d.oy + ddy, 8, vp.h - RING - 8) });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (!d.moved) {
      setHint(false);
      setOpen((o) => !o);
    }
  };
  // 面板顶栏拖动手柄：复用 onPointerDown/onPointerMove 移动 pos，但 up 时不 toggle（仅拖动）。
  const onHeaderPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // 规划学期 = 在读学期(term) 的下一个学期。
  const planTerm = term + 1;
  const planLabel = useMemo(
    () => termToCalLabel(enrollYear(selectedPlan), planTerm),
    [selectedPlan, planTerm],
  );

  // 周课表落格：下学期必修 + 待选清单（逻辑见 lib/schedulePlacement）。
  const placed = useMemo(
    () => buildPlacement(view.nextSemRequired, cartCourses, formalSections, planLabel, chosen, selectedPlan),
    [view.nextSemRequired, cartCourses, formalSections, planLabel, chosen, selectedPlan],
  );
  // 待选清单展示用：每门 cart / required 课的落格班级（选班结果）。
  const sectionInfo = useMemo(() => {
    const m: Record<string, { className?: string; placed: boolean }> = {};
    for (const p of placed) {
      const active = p.options.find((o) => o.key === p.activeKey);
      m[p.cid] = { className: active?.className, placed: p.status === "placed" };
    }
    return m;
  }, [placed]);

  // 点必修列表项 → 跳「所选班级」section 详情；没落格就静默（必修无 Course 对象，无法退回预选详情）。
  const handleSelectRequired = (cid: string) => {
    const pc = placed.find((p) => p.cid === cid);
    if (!pc) return;
    const opt = pc.options.find((o) => o.key === pc.activeKey) ?? pc.options[0];
    if (opt?.section) onSelectSection(opt.section);
  };

  const handleCopyRequired = async (cid: string) => {
    const ok = await copyText(cid);
    if (ok) {
      setRequiredCopiedId(cid);
      setTimeout(() => setRequiredCopiedId((cur) => (cur === cid ? null : cur)), 1200);
      notify(`已复制课程号 ${cid}`);
    } else {
      notify("复制失败，请手动复制");
    }
  };

  // 点待选清单课程 → 跳「所选班级」的 section 详情；无开课班级（未发布）才退回预选课程详情。
  const handleSelectCart = (course: Course) => {
    const pc = placed.find((p) => p.cid === course.id);
    const opt = pc?.options.find((o) => o.key === pc.activeKey) ?? pc?.options[0];
    if (opt?.section) onSelectSection(opt.section);
    else onSelectCourse(course);
  };

  const cap = view.nextSemCap;
  const used = view.nextSemCredits;
  const over = view.nextSemOver;
  const ringPct = Math.min(1, cap > 0 ? used / cap : 0);

  const R = 26;
  const C = 2 * Math.PI * R;
  const ringColor = over ? "#dc2626" : "#ef4444";

  // 面板定位：窄屏 → 底部 bottom-sheet（全宽）；宽屏 → 圆环旁、视口内居中夹住。
  // 高度以「完整显示整张周课表」为准（不再被圆环到屏边的空隙限制）；三个 tab 同高，切换不跳变。
  const isMobile = vp.w < 640;
  const ringCx = pos.x + RING / 2;
  const ringCy = pos.y + RING / 2;
  const onRight = ringCx > vp.w / 2;
  let panelH: number;
  let panelStyle: React.CSSProperties;
  let transformOrigin: string;
  if (isMobile) {
    panelH = Math.round(vp.h * 0.88);
    panelStyle = { left: 8, right: 8, bottom: 8 };
    transformOrigin = "bottom center";
  } else {
    const panelW = Math.min(520, vp.w - 16);
    const GAP = 12;
    // 面板放圆环「外侧」，与圆环留 GAP 不重叠：圆环在右半屏→面板放其左侧，否则放右侧；放不下则翻面，最后夹屏。
    let onLeftOfRing = onRight;
    let panelLeft = onLeftOfRing ? pos.x - panelW - GAP : pos.x + RING + GAP;
    if (onLeftOfRing && panelLeft < 8) { onLeftOfRing = false; panelLeft = pos.x + RING + GAP; }
    else if (!onLeftOfRing && panelLeft + panelW > vp.w - 8) { onLeftOfRing = true; panelLeft = pos.x - panelW - GAP; }
    panelLeft = clamp(panelLeft, 8, Math.max(8, vp.w - panelW - 8));
    panelH = Math.min(660, vp.h - 16); // ≈ 面板chrome + 学期提示 + 7行×52网格 + 图例
    const top = clamp(ringCy - panelH / 2, 8, Math.max(8, vp.h - panelH - 8));
    panelStyle = { left: panelLeft, top, width: panelW };
    transformOrigin = `center ${onLeftOfRing ? "right" : "left"}`;
  }

  return (
    <>
      {/* 展开面板 */}
      <div
        className={`fixed z-40 transition-[opacity,transform] duration-300 ease-out ${
          open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
        }`}
        style={{ ...panelStyle, transformOrigin }}
      >
        <div className="relative bg-white rounded-2xl border border-gray-100 shadow-[0_16px_48px_rgba(0,0,0,0.16)] overflow-hidden flex flex-col" style={{ height: panelH }}>
          {/* 顶栏 —— 左侧整块作拖动手柄（可拖动面板），右侧按钮区不拖 */}
          <div className="px-4 py-3 flex items-center gap-2 shrink-0 border-b border-gray-100">
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onHeaderPointerUp}
              title="拖动移动面板"
              className="flex items-center gap-2 flex-1 min-w-0 cursor-grab select-none"
              style={{ touchAction: "none" }}
            >
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-red-50 text-red-500 shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </span>
              <span className="text-[13px] font-bold text-gray-800 shrink-0">模拟选课</span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 ${
                  over ? "text-rose-700 bg-rose-50 border-rose-200" : "text-gray-500 bg-gray-50 border-gray-200"
                }`}
                title="下学期已规划学分 / 每学期上限 30"
              >
                下学期 {used}/{cap}{over ? " 超限" : ""}
              </span>
            </div>
            <div className="inline-flex items-center gap-1 text-[11px] text-gray-400">
              <button
                onClick={onEditEarned}
                aria-label="编辑已修"
                title="编辑已修"
                className="w-6 h-6 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="收起面板"
                className="w-6 h-6 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* tab 条 */}
          <div className="flex items-center gap-1 px-3 pt-2.5 shrink-0">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors ${
                    active ? "text-red-600 bg-red-50" : "text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {t.label}
                  {t.key === "cart" && cartCourses.length > 0 && (
                    <span className="ml-1 text-[10px] font-bold text-red-500">{cartCourses.length}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* tab 内容 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            <div key={tab} className="sim-tab-in">
            {tab === "cart" && (
              <div className="space-y-3">
                {/* 下学期必修 —— 折叠保护（防误删；复学/转专业可展开取消） */}
                {(view.nextSemRequired.length > 0 || view.nextSemRequiredExcluded.length > 0) && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50/40 overflow-hidden">
                    <button
                      onClick={() => setReqOpen((v) => !v)}
                      className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-blue-50/70 transition-colors"
                    >
                      <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 shrink-0" />
                      <span className="text-[12px] font-bold text-gray-700">下学期必修 · {view.nextSemRequired.length} 门</span>
                      {view.nextSemRequiredExcluded.length > 0 && (
                        <span className="text-[10px] text-gray-400">已取消 {view.nextSemRequiredExcluded.length}</span>
                      )}
                      <span className="ml-auto text-[10px] text-gray-400">{reqOpen ? "收起" : "展开管理"}</span>
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${reqOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                    {reqOpen && (
                      <div className="px-2 pb-2 space-y-1.5">
                        <div className="px-1 pt-1 text-[10px] text-gray-400 leading-relaxed">
                          必修按培养方案自动排入下学期。复学 / 转专业等情况可取消某门；取消后仍可恢复。
                        </div>
                        {view.nextSemRequired.map((c) => {
                          const info = sectionInfo[c.cid];
                          const isSelected = selectedCourseId === c.cid;
                          const copied = requiredCopiedId === c.cid;
                          return (
                            <div
                              key={c.cid}
                              onClick={() => handleSelectRequired(c.cid)}
                              className={`rounded-lg border transition-colors p-2 flex items-center gap-2.5 cursor-pointer ${
                                isSelected
                                  ? "border-blue-400 bg-blue-50 ring-1 ring-blue-200"
                                  : "border-blue-100 bg-white hover:border-blue-300"
                              }`}
                            >
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold shrink-0 bg-blue-100 text-blue-700">
                                {c.credits}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-semibold text-gray-800 truncate">{c.name}</div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-400">
                                  <span className="font-mono text-gray-500">{c.cid}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleCopyRequired(c.cid); }}
                                    title="复制课程号"
                                    className={`inline-flex items-center justify-center w-4 h-4 rounded transition-colors ${
                                      copied ? "text-green-500" : "text-gray-300 hover:text-gray-600"
                                    }`}
                                  >
                                    {copied ? (
                                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    ) : (
                                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                                    )}
                                  </button>
                                  <span className="text-gray-300">·</span>
                                  <span className="truncate">
                                    {info?.className ? `班级 ${info.className}` : info && !info.placed ? "课表待发布" : "班级待定"}
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); requestCancelRequired(c.cid, c.name); }}
                                title="取消这门必修"
                                className="text-gray-300 hover:text-rose-500 shrink-0"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                                </svg>
                              </button>
                            </div>
                          );
                        })}
                        {view.nextSemRequiredExcluded.map((c) => {
                          return (
                            <div
                              key={c.cid}
                              className="rounded-lg border border-gray-100 bg-gray-50 p-2 flex items-center gap-2.5 opacity-70"
                            >
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold shrink-0 bg-gray-200 text-gray-400">
                                {c.credits}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-medium text-gray-400 line-through truncate">{c.name}</div>
                                <div className="mt-0.5 text-[10px] text-gray-300 font-mono">{c.cid}</div>
                              </div>
                              <button
                                onClick={() => onCancelRequired(c.cid)}
                                className="text-[10px] text-blue-500 border border-blue-200 rounded-md px-1.5 py-0.5 hover:bg-blue-50 transition-colors shrink-0"
                              >
                                恢复
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 待选清单 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                      已加入 {cartCourses.length} 门
                    </span>
                    {cartCourses.length > 0 && (
                      <button onClick={onClear} className="text-[11px] text-gray-400 hover:text-rose-500">清空</button>
                    )}
                  </div>
                  <CartList
                    courses={cartCourses}
                    selectedPlan={selectedPlan}
                    onRemove={onRemove}
                    sectionInfo={sectionInfo}
                    onNotify={notify}
                    onSelect={handleSelectCart}
                    selectedId={selectedCourseId ?? undefined}
                  />
                  <a
                    href={JWXT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-2.5 inline-flex items-center justify-center gap-1.5 text-red-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                    <span className="text-[12px] font-medium border-b border-dashed border-red-300">点击跳转至学校官方选课系统</span>
                  </a>
                  {cartCourses.length > 0 && (
                    <button
                      onClick={() => notify("该功能未开放")}
                      className="w-full mt-2 h-9 rounded-xl border border-gray-200 text-[12px] font-medium text-gray-500 hover:border-gray-300 hover:bg-gray-50 inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
                      </svg>
                      生成一键选课命令
                    </button>
                  )}
                </div>

                {/* 方案分享：保存为码 / 粘贴恢复（无后端，自包含 base64url） */}
                <div className="mt-3 rounded-xl border border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShareOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 rounded-xl"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
                      </svg>
                      保存 / 恢复方案
                    </span>
                    <svg className={`w-3.5 h-3.5 transition-transform ${shareOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {shareOpen && (
                    <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-100">
                      {/* 保存 */}
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">保存为分享码</div>
                        <button
                          type="button"
                          onClick={handleSaveBundle}
                          disabled={shareBusy || !selectedPlan}
                          className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[12px] font-bold hover:bg-red-600 disabled:bg-gray-200 disabled:text-gray-400"
                        >
                          {shareBusy ? "生成中…" : "生成分享码"}
                        </button>
                        {shareCode && (
                          <div className="mt-2 space-y-1.5">
                            <textarea
                              readOnly
                              value={shareCode}
                              onFocus={(e) => e.currentTarget.select()}
                              className="w-full h-16 px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-[11px] font-mono leading-relaxed resize-none outline-none focus:border-red-300"
                            />
                            <div className="flex gap-1.5">
                              <button onClick={handleCopyCode} className="flex-1 px-2 py-1 rounded-md border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50">复制码</button>
                              <button onClick={handleCopyLink} className="flex-1 px-2 py-1 rounded-md border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50">复制链接</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {/* 恢复 */}
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">从分享码恢复</div>
                        <textarea
                          value={pasteCode}
                          onChange={(e) => setPasteCode(e.target.value)}
                          placeholder="粘贴 v1z: 或 v1: 开头的分享码"
                          className="w-full h-16 px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-[11px] font-mono leading-relaxed resize-none outline-none focus:border-red-300"
                        />
                        <button
                          type="button"
                          onClick={handleApplyPaste}
                          disabled={shareBusy || !pasteCode.trim()}
                          className="mt-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-[12px] font-bold hover:bg-red-50 disabled:border-gray-200 disabled:text-gray-300"
                        >
                          {shareBusy ? "解码中…" : "应用方案（覆盖当前）"}
                        </button>
                      </div>
                      <p className="text-[10.5px] text-gray-400 leading-relaxed">
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "schedule" && (
              <div>
                <div className="text-[11px] text-gray-400 mb-2">
                  规划学期：<span className="font-semibold text-gray-600">{planLabel || "—"}</span>
                  <span className="ml-1">（第 {planLabel ? planTerm : "—"} 学期 ）</span>
                </div>
                <SimScheduleGrid
                  placed={placed}
                  onChooseSection={onChooseSection}
                  onCancelRequired={requestCancelRequired}
                  onRemoveCart={onRemove}
                />
              </div>
            )}

            {tab === "credit" && (
              <div className="flex flex-col items-center">
                {!selectedPlan ? (
                  <div className="text-[12px] text-gray-400 py-10 text-center">请先选择培养方案</div>
                ) : (
                  <>
                    <CreditRing view={view} size={120} stroke={12} />
                    <CreditRingLegend className="mt-2.5" showFuture={showFutureRequired} />
                    <FutureRequiredToggle
                      checked={showFutureRequired}
                      onChange={setShowFutureRequired}
                      className="mt-2.5 w-full justify-center"
                    />
                    <div className="mt-3 w-full space-y-0">
                      {view.blocks.map((b) => (
                        <CreditBar key={b.key} block={b} />
                      ))}
                    </div>
                    <div className="mt-2 w-full flex items-baseline justify-between">
                      <span className="text-gray-500 text-[13px] font-semibold">毕业还差</span>
                      <span className="font-black text-gray-800 text-[22px] leading-none">
                        {view.totalRemaining ?? "?"}<span className="text-[12px] text-gray-400 font-medium"> 学分</span>
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          </div>

          {/* 轻提示 toast（复制 / 桩功能） */}
          {notice && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-3 px-3 py-1.5 rounded-full bg-gray-900 text-white text-[11px] font-medium shadow-lg pointer-events-none whitespace-nowrap">
              {notice}
            </div>
          )}
        </div>
      </div>

      {/* 进入提示气泡（4s 后或交互后消失） */}
      {hint && !open && (
        <div
          className="fixed z-40 pointer-events-none -translate-x-1/2 transition-opacity duration-300"
          style={{ left: clamp(ringCx, 70, vp.w - 70), top: pos.y - 44 }}
        >
          <div className="px-3 py-1.5 rounded-full bg-gray-900 text-white text-[11px] font-semibold shadow-lg whitespace-nowrap animate-bounce">
            点击查看模拟选课详细信息
          </div>
          <svg
            className="w-3 h-1.5 text-gray-900 fill-current mx-auto block -mt-[1px]"
            viewBox="0 0 12 6"
          >
            <path d="M0,0 C3,0 4.5,4.5 6,4.5 C7.5,4.5 9,0 12,0 Z" />
          </svg>
        </div>
      )}

      {/* 悬浮圆环（可拖动） */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={open ? "收起" : "展开模拟选课 · 可拖动"}
        className="fixed z-40 w-16 h-16 rounded-full bg-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] border border-gray-100 flex items-center justify-center hover:shadow-[0_10px_28px_rgba(0,0,0,0.22)] active:scale-95 transition-shadow"
        style={{ left: pos.x, top: pos.y, touchAction: "none", cursor: "grab" }}
      >
        {/* 进入时的脉冲提示环 */}
        {hint && !open && (
          <span className="absolute inset-0 rounded-full bg-red-400/30 animate-ping" />
        )}
        <svg width="60" height="60" viewBox="0 0 60 60" className="absolute inset-0 m-auto">
          <circle cx="30" cy="30" r={R} fill="none" stroke="#f3f4f6" strokeWidth="5" />
          <circle
            cx="30" cy="30" r={R} fill="none" stroke={ringColor} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${ringPct * C} ${C}`}
            transform="rotate(-90 30 30)"
            style={{ transition: "stroke-dasharray .35s ease" }}
          />
        </svg>
        <div className="relative flex flex-col items-center leading-none pointer-events-none">
          <span className={`text-[15px] font-black ${over ? "text-rose-600" : "text-gray-800"}`}>{used}</span>
          <span className="text-[8px] text-gray-400 font-mono">/{cap}</span>
        </div>
        {cartCourses.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow pointer-events-none">
            {cartCourses.length}
          </span>
        )}
      </button>

      {/* 取消必修确认窗 */}
      <ConfirmDialog
        open={pendingCancel !== null}
        title="取消这门必修课？"
        message={pendingCancel ? `《${pendingCancel.name}》将不计入下学期课表与必修学分。复学 / 转专业等情况可取消，之后仍可在待选清单里恢复。` : ""}
        confirmText="取消该必修"
        cancelText="再想想"
        onConfirm={() => {
          if (pendingCancel) onCancelRequired(pendingCancel.cid);
          setPendingCancel(null);
        }}
        onCancel={() => setPendingCancel(null)}
      />
    </>
  );
}
