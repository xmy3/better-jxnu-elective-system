import { useEffect, useState, useCallback } from "react";

export type ThemePref = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "jxnu_theme";

function readPref(): ThemePref {
  if (typeof window === "undefined") return "auto";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "auto" ? v : "auto";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === "auto") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

/** 写 <html class="dark"> 与 data-theme，供 CSS 与 echarts/inline 样式读取 */
function applyDom(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
}

/**
 * 主题三态：auto / light / dark。
 * - 持久化到 localStorage["jxnu_theme"]，默认 auto
 * - auto 模式实时跟随系统 prefers-color-scheme
 * - 跨标签页同步（storage 事件）
 *
 * 首屏防闪烁靠 index.html 的内联脚本预先设置 .dark class —— 这里只负责后续切换。
 */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readPref()));

  useEffect(() => {
    const next = resolve(pref);
    setResolved(next);
    applyDom(next);
    localStorage.setItem(STORAGE_KEY, pref);
  }, [pref]);

  // 系统主题变化（仅 auto 模式下生效）
  useEffect(() => {
    if (pref !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolved(next);
      applyDom(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  // 跨标签页同步
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      if (e.newValue === "light" || e.newValue === "dark" || e.newValue === "auto") {
        setPrefState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPref = useCallback((p: ThemePref) => setPrefState(p), []);

  return { pref, resolved, setPref };
}
