import type { Course, FormalSection, PlanCourse } from "../types";
import { parseSchedule } from "./scheduleParse";
import type { MeetSlot } from "./scheduleParse";
import { courseNature } from "./creditPlan";

// 把「下学期必修 + 待选清单」映射到周课表的可落格条目（下学期 = 在读学期 + 1）。
// 时段优先取规划学期 section；缺失时退回该课最近开课学期（preview，srcSem 标记）。
// SimPanel（面板）与 OnboardingModal（引导第6步）共用，避免逻辑分叉。

export type PlacedKind = "required" | "cart";
export type PlacedStatus = "placed" | "none";

/** 一门课的一个可选班级（section）。key = "班级名|教号"。 */
export interface PlacedOption {
  key: string;
  slots: MeetSlot[];
  teacher?: string;
  classroom?: string;
  className?: string;
  /** 该班级对应的原始 section（用于点待选清单跳转到对应班级详情）。 */
  section: FormalSection;
}

export interface PlacedCourse {
  cid: string;
  name: string;
  credits: number;
  kind: PlacedKind;
  /** 在所选培养方案下的课程性质（已归一化）。供网格按标签色着色。 */
  nature: string;
  status: PlacedStatus;
  slots: MeetSlot[];
  teacher?: string;
  classroom?: string;
  /** 时段所取自的学期（用于 preview 提示）。 */
  srcSem?: string;
  /** 该课在所取学期的开课班级数（>1 → 可选班）。 */
  altCount?: number;
  /** 全部可选班级（有时段的）；默认落格 = options[0] 或 chosen 覆盖。 */
  options: PlacedOption[];
  /** 当前落格的班级 key。 */
  activeKey?: string;
}

type Resolved = Pick<PlacedCourse, "status" | "slots" | "teacher" | "classroom" | "srcSem" | "altCount" | "options" | "activeKey">;

const optionKey = (s: FormalSection) => `${s.className}|${s.teacherId}`;

export function buildPlacement(
  nextSemRequired: PlanCourse[],
  cartCourses: Course[],
  formalSections: FormalSection[],
  planLabel: string,
  chosen: Record<string, string> = {},
  selectedPlan = "",
): PlacedCourse[] {
  const byCid = new Map<string, PlacedCourse>();
  const resolve = (cid: string): Resolved => {
    const all = formalSections.filter((s) => s.id === cid);
    if (all.length === 0) return { status: "none", slots: [], options: [] };
    const sems = [...new Set(all.map((s) => s.semester))];
    const sem = planLabel && sems.includes(planLabel) ? planLabel : [...sems].sort().at(-1)!;
    const inSem = all.filter((s) => s.semester === sem);
    const options: PlacedOption[] = inSem
      .map((s) => ({ key: optionKey(s), slots: parseSchedule(s.schedule), teacher: s.teacher, classroom: s.classroom, className: s.className, section: s }))
      .filter((o) => o.slots.length > 0);
    if (options.length === 0) return { status: "none", slots: [], options: [] };
    const active = options.find((o) => o.key === chosen[cid]) ?? options[0];
    return {
      status: "placed",
      slots: active.slots,
      teacher: active.teacher,
      classroom: active.classroom,
      srcSem: sem,
      altCount: inSem.length,
      options,
      activeKey: active.key,
    };
  };
  for (const c of nextSemRequired) {
    byCid.set(c.cid, { cid: c.cid, name: c.name, credits: c.credits, kind: "required", nature: c.nature, ...resolve(c.cid) });
  }
  for (const c of cartCourses) {
    if (byCid.has(c.id)) continue;
    byCid.set(c.id, {
      cid: c.id,
      name: c.name,
      credits: c.credits || 0,
      kind: "cart",
      nature: courseNature(c, selectedPlan),
      ...resolve(c.id),
    });
  }
  return [...byCid.values()];
}

/** 落格时段取自非规划学期的那些学期（用于 preview 提示文案）。 */
export function previewSemsOf(placed: PlacedCourse[], planLabel: string): string[] {
  return [
    ...new Set(
      placed
        .filter((p) => p.status === "placed" && p.srcSem && p.srcSem !== planLabel)
        .map((p) => p.srcSem!),
    ),
  ];
}
