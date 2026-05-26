import { useCallback, useEffect, useState } from "react";
import type { PlanCourse } from "../types";

type PlanCourseMap = Record<string, PlanCourse[]>;

// 懒加载 public/plan_courses.json（约 5MB）：仅在 enabled（模拟选课开启）时 fetch 一次并缓存。
// courses = 当前 planKey 对应的方案课程清单（空方案或未命中 → []）。
// coursesOf(key) = 任意 planKey 的方案课程清单（转专业用，复用同一份缓存 map，不额外 fetch）。
export function usePlanCourses(enabled: boolean, planKey: string) {
  const [map, setMap] = useState<PlanCourseMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || map) return;
    let cancelled = false;
    setLoading(true);
    fetch("/plan_courses.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: PlanCourseMap) => {
        if (cancelled) return;
        setMap(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, map]);

  const courses = planKey && map ? map[planKey] ?? [] : [];
  const coursesOf = useCallback(
    (key: string): PlanCourse[] => (key && map ? map[key] ?? [] : []),
    [map],
  );
  return { courses, coursesOf, loading, error, ready: map != null };
}
