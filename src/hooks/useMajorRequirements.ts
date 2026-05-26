import { useEffect, useState } from "react";
import type { MajorRequirement } from "../types";

// 毕业学分 / 专业限选学分 / 按性质汇总。备用 hook，当前 UI 暂未消费。
export function useMajorRequirements() {
  const [requirements, setRequirements] = useState<MajorRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/major_requirements.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: MajorRequirement[]) => {
        if (cancelled) return;
        setRequirements(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { requirements, loading, error };
}
