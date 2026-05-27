// 学生档案导入 —— 形状对齐 D1 student_records.record_json（build_student_records.py 产出）。
// 引导里输学号+姓名即可一键带出 方案/在读学期/已修学分/本学期选修/已修限选/核对必修，跳过手填。
import type { PlanCourse } from "../types";
import { REQUIRED_NATURES, isEnglishOffsetCourse } from "./creditPlan";
import { effectiveTermIndex, isDeferredSettlement } from "./term";

/** 课表里的一节课（正在修读的本学期课程）。schedule 与 formal_sections 同口径："星期三-第89节"，多段以 " / " 连接。 */
export interface StudentScheduleItem {
  courseId: string;
  courseName: string;
  teacher?: string;
  classroom?: string;
  schedule?: string;
  credits?: number;
}

/** 已修明细里的一门课。 */
export interface StudentDetailCourse {
  courseId: string;
  courseName: string;
  credits: number;
  /** 课程性质（已归一化：公共必修课 / 专业限选 …，build 时联 plan_courses 补，可缺）。 */
  nature?: string;
  /** 修读学期原文（"24-25第1学期"，可缺）。 */
  semester?: string;
  /** 该课在培养方案里是第几学期（build 时按 enrollY 推算；0/缺 = 未知）。 */
  planTermIndex?: number;
  /** 成绩，及格判断用；缺省视为通过。 */
  grade?: number | string;
  passed?: boolean;
}

export interface StudentRecord {
  studentId: string;
  // 脱敏：不含姓名。
  className?: string;
  /** 离线匹配出来的 planKey（"2023级-英语"），未命中则 undefined。 */
  planKey?: string;
  /** 该档案对应学期 label（"25-26第2学期"）。 */
  termLabel?: string;
  /** 在读是培养方案第几学期（build 算好；缺 = 无法推算）。 */
  readingPlanTerm?: number;
  /** 培养方案 ti<=在读 的必修 cid 全集（build 算好；核对必修自动排除用）。 */
  requiredCidsUpToReading?: string[];
  scheduleItems: StudentScheduleItem[];
  detailCourses: StudentDetailCourse[];
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 一门已修课是否算通过（无成绩字段时默认通过；passed 显式 false / 成绩含「不及格」「F」时不通过）。 */
export function isPassed(c: StudentDetailCourse): boolean {
  if (c.passed === false) return false;
  const g = str(c.grade);
  if (!g) return true;
  if (/不及格|不通过|缺考|作弊|F\b/i.test(g)) return false;
  const n = Number(g);
  if (Number.isFinite(n)) return n >= 60;
  return true;
}

/**
 * 容错解析粘贴 / mock 的学生档案 JSON（字符串或已解析对象皆可）。
 * 字段缺失时降级，形状不对返回 null。
 */
export function parseStudentRecord(input: string | Record<string, unknown>): StudentRecord | null {
  let obj: Record<string, unknown>;
  try {
    obj = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const sid = str(obj.studentId ?? obj.xh ?? obj.学号);
  const rawSchedule = (obj.scheduleItems ?? obj.schedule ?? []) as unknown[];
  const rawDetail = (obj.detailCourses ?? obj.courses ?? []) as unknown[];
  if (!sid && !Array.isArray(rawSchedule) && !Array.isArray(rawDetail)) return null;

  const scheduleItems: StudentScheduleItem[] = (Array.isArray(rawSchedule) ? rawSchedule : []).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      courseId: str(o.courseId ?? o.kch ?? o.课程号),
      courseName: str(o.courseName ?? o.kcmc ?? o.课程名称),
      teacher: str(o.teacher ?? o.js ?? o.教师) || undefined,
      classroom: str(o.classroom ?? o.js ?? o.教室) || undefined,
      schedule: str(o.schedule ?? o.sksj ?? o.上课时间) || undefined,
      credits: o.credits != null ? num(o.credits) : undefined,
    };
  });

  const detailCourses: StudentDetailCourse[] = (Array.isArray(rawDetail) ? rawDetail : []).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      courseId: str(o.courseId ?? o.kch ?? o.课程号),
      courseName: str(o.courseName ?? o.kcmc ?? o.课程名称),
      credits: num(o.credits ?? o.xf ?? o.学分),
      nature: str(o.nature ?? o.kcxz ?? o.课程性质) || undefined,
      semester: str(o.semester ?? o.xq ?? o.学期) || undefined,
      planTermIndex: o.planTermIndex != null ? num(o.planTermIndex) : undefined,
      grade: (o.grade ?? o.cj ?? o.成绩) as number | string | undefined,
      passed: typeof o.passed === "boolean" ? o.passed : undefined,
    };
  });

  const rawRequired = obj.requiredCidsUpToReading;
  return {
    studentId: sid,
    className: str(obj.className ?? obj.bj ?? obj.班级) || undefined,
    planKey: str(obj.planKey) || undefined,
    termLabel: str(obj.termLabel ?? obj.xq ?? obj.学期) || undefined,
    readingPlanTerm: obj.readingPlanTerm != null ? num(obj.readingPlanTerm) || undefined : undefined,
    requiredCidsUpToReading: Array.isArray(rawRequired)
      ? rawRequired.filter((x): x is string => typeof x === "string")
      : undefined,
    scheduleItems,
    detailCourses,
  };
}

/** 学号导入后可一次性回填引导各步的建议值。 */
export interface ImportSuggestion {
  /** 在读培养方案第几学期（缺 = 无法推算，引导沿用自动推算）。 */
  term?: number;
  /** 已修总学分（不含本学期；往期所有课，含必修+选修）。 */
  totalEarned: number;
  /** 本学期（在读）已选选修学分（含专业限选，不含必修）。 */
  electiveThisSem: number;
  /** 已修专业限选 cid（往期 + 本期）。 */
  takenMajorElectiveCids: string[];
  /** 核对必修：培养方案要求但档案里没出现的必修 cid（自动排除）。 */
  excludedRequiredCids: string[];
  /** 已修课程总数（去重 cid）。 */
  takenCount: number;
  /** 本学期总学分（必修+选修，仅供展示）。 */
  readingCredits: number;
}

/**
 * 从档案派生引导各步建议值（含特色课抵扣）。
 * 特色课按序号 1:1 顶替缺失的大英Ⅲ/Ⅳ：抵了的特色课学分挪进 totalEarned（与新增的 prevReq 对消），
 * 未抵的特色课保持「本学期必修」不进 electiveThisSem。
 */
export function deriveInputsFromRecord(record: StudentRecord, planCourses?: PlanCourse[]): ImportSuggestion {
  const term = record.readingPlanTerm;
  const taken = new Set<string>();

  // 收集特色课信息（排序后用于抵扣匹配）。
  const allSpecials: { courseId: string; pti: number; credits: number }[] = [];
  for (const c of record.detailCourses) {
    if (!isPassed(c)) continue;
    if (c.courseId) taken.add(c.courseId);
    if (c.nature === "大学英语特色课" && c.courseId) {
      const pti = c.planTermIndex ?? 0;
      if (pti > 0) allSpecials.push({ courseId: c.courseId, pti, credits: c.credits });
    }
  }
  allSpecials.sort((a, b) => a.pti - b.pti || a.courseId.localeCompare(b.courseId));

  // 计算哪些缺口被特色课抵了（需要 planCourses 来识别大英Ⅲ/Ⅳ）。
  const rawMissing = (record.requiredCidsUpToReading ?? []).filter(
    (cid) => !taken.has(cid) && !isDeferredSettlement(cid),
  );
  let coveredCount = 0;
  if (planCourses && allSpecials.length > 0) {
    const byCid = new Map(planCourses.map((c) => [c.cid, c]));
    const englishMissing = rawMissing
      .filter((cid) => {
        const pc = byCid.get(cid);
        return pc != null && isEnglishOffsetCourse(pc.name);
      })
      .sort((a, b) => {
        const pa = byCid.get(a)!;
        const pb = byCid.get(b)!;
        return effectiveTermIndex(pa.cid, pa.semester) - effectiveTermIndex(pb.cid, pb.semester);
      });
    coveredCount = Math.min(allSpecials.length, englishMissing.length);
  }
  const offsetSpecialIds = new Set(allSpecials.slice(0, coveredCount).map((s) => s.courseId));

  let totalEarned = 0;
  let electiveThisSem = 0;
  let readingCredits = 0;
  const takenMajorElectiveCids: string[] = [];

  for (const c of record.detailCourses) {
    if (!isPassed(c)) continue;
    const pti = c.planTermIndex ?? 0;
    const isReading = term != null && term > 0 && pti === term;
    if (c.nature === "专业限选" && c.courseId) takenMajorElectiveCids.push(c.courseId);
    if (isReading) {
      readingCredits += c.credits;
      if (c.nature === "大学英语特色课" && c.courseId != null && offsetSpecialIds.has(c.courseId)) {
        // 本学期 offset 特色课：不在 totalEarned 里（reading），计为非必修进 electiveThisSem，
        // 与新增 prevReq 对消（prevReq +2, electiveThisSem +2 → 净 0）。
        electiveThisSem += c.credits;
      } else {
        // 必修（含未抵特色课）不计本学期选修。
        const isRequired =
          c.nature != null && (REQUIRED_NATURES.includes(c.nature) || c.nature === "大学英语特色课");
        if (!isRequired) electiveThisSem += c.credits;
      }
    } else {
      totalEarned += c.credits;
    }
  }

  // 核对必修缺口：rawMissing 减去被特色课抵掉的。
  let excludedRequiredCids: string[];
  if (planCourses && coveredCount > 0) {
    const byCid = new Map(planCourses.map((c) => [c.cid, c]));
    const englishMissingCids = rawMissing
      .filter((cid) => {
        const pc = byCid.get(cid);
        return pc != null && isEnglishOffsetCourse(pc.name);
      })
      .sort((a, b) => {
        const pa = byCid.get(a)!;
        const pb = byCid.get(b)!;
        return effectiveTermIndex(pa.cid, pa.semester) - effectiveTermIndex(pb.cid, pb.semester);
      });
    const coveredGapCids = new Set(englishMissingCids.slice(0, coveredCount));
    excludedRequiredCids = rawMissing.filter((cid) => !coveredGapCids.has(cid));
  } else {
    excludedRequiredCids = rawMissing;
  }

  return {
    term: term && term > 0 ? term : undefined,
    totalEarned,
    electiveThisSem,
    takenMajorElectiveCids,
    excludedRequiredCids,
    takenCount: taken.size,
    readingCredits,
  };
}

/**
 * 学号导入「核对必修」的自动取消勾选集：培养方案 ti≤在读 的必修全集中、
 * 档案里没修过的 cid → 标缺口（取消勾选）。两条修正：
 *   1) 跳过延迟结算课（形势与政策等不进课表的必修），避免误判成缺口。
 *   2) 大学英语特色课按序号 1:1 顶替缺失的大英Ⅲ/Ⅳ（第1个→Ⅲ，第2个→Ⅳ）。
 */
export function computeImportExclusions(record: StudentRecord, planCourses: PlanCourse[]): string[] {
  const term = record.readingPlanTerm;
  const taken = new Set<string>();
  const specialPtis: number[] = [];
  for (const c of record.detailCourses) {
    if (!isPassed(c)) continue;
    if (c.courseId) taken.add(c.courseId);
    if (c.nature === "大学英语特色课") {
      const pti = c.planTermIndex ?? 0;
      if (term != null && term > 0 && pti > 0) specialPtis.push(pti);
    }
  }
  specialPtis.sort((a, b) => a - b);

  const byCid = new Map(planCourses.map((c) => [c.cid, c]));
  const missing = (record.requiredCidsUpToReading ?? []).filter(
    (cid) => !taken.has(cid) && !isDeferredSettlement(cid),
  );

  if (specialPtis.length > 0) {
    // 按序号：第1个特色课→大英III，第2个→大英IV。
    const englishMissing = missing
      .filter((cid) => {
        const pc = byCid.get(cid);
        return pc != null && isEnglishOffsetCourse(pc.name);
      })
      .sort((a, b) => {
        const pa = byCid.get(a)!;
        const pb = byCid.get(b)!;
        return effectiveTermIndex(pa.cid, pa.semester) - effectiveTermIndex(pb.cid, pb.semester);
      });

    const covered = new Set<string>();
    for (let i = 0; i < Math.min(specialPtis.length, englishMissing.length); i++) {
      covered.add(englishMissing[i]);
    }
    return missing.filter((cid) => !covered.has(cid));
  }
  return missing;
}

/**
 * 按【学号】拉取学生档案（接 functions/api/student-record → D1 student_records 表）。
 * 脱敏：全程不涉及姓名。学号查不到统一 404。
 * 注意：源数据无成绩字段，detailCourses 一律视为已通过（isPassed 返回 true）。
 */
export async function importStudentRecord(studentId: string): Promise<StudentRecord> {
  const sid = studentId.trim();
  if (!sid) throw new Error("请输入学号。");

  const url = `/api/student-record?sid=${encodeURIComponent(sid)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("网络异常，稍后再试。");
  }

  // 本地 dev 没起 Functions，/api/* 会回 index.html —— 用 content-type 判一下。
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("接口未部署或返回了非 JSON。");
  }

  if (res.status === 404) throw new Error("没有该学号的记录。");
  if (!res.ok) throw new Error(`服务异常（${res.status}）。`);

  const data = (await res.json()) as Record<string, unknown>;
  const rec = parseStudentRecord(data);
  if (!rec) throw new Error("返回数据格式异常。");
  return rec;
}
