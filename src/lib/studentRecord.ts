// 学生档案导入 —— 形状对齐 D1 student_records.record_json（build_student_records.py 产出）。
// 引导里输学号+姓名即可一键带出 方案/在读学期/已修学分/本学期选修/已修限选/核对必修，跳过手填。
import { REQUIRED_NATURES } from "./creditPlan";

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
 * 从档案派生引导各步建议值。靠 build 算好的 planTermIndex / nature / readingPlanTerm /
 * requiredCidsUpToReading，纯用 record 自身字段，不依赖 planCourses 加载时序。
 * 注意：源数据无成绩，全部视为已通过（isPassed 恒真）；早期学期快照可能缺失 → 已修学分可能偏低，需提示核对。
 */
export function deriveInputsFromRecord(record: StudentRecord): ImportSuggestion {
  const term = record.readingPlanTerm;
  const taken = new Set<string>();
  let totalEarned = 0;
  let electiveThisSem = 0;
  let readingCredits = 0;
  const takenMajorElectiveCids: string[] = [];

  for (const c of record.detailCourses) {
    if (!isPassed(c)) continue;
    if (c.courseId) taken.add(c.courseId);
    const pti = c.planTermIndex ?? 0;
    const isReading = term != null && term > 0 && pti === term;
    // 「大学英语特色课」是选择性必修（1:1 抵扣大学英语III/IV），按必修性质处理 —— 禁止计入本学期选修，
    //   否则会把它当通用选修多算（本学期选修 8 → 6）。
    const isRequired =
      c.nature != null && (REQUIRED_NATURES.includes(c.nature) || c.nature === "大学英语特色课");
    if (c.nature === "专业限选" && c.courseId) takenMajorElectiveCids.push(c.courseId);
    if (isReading) {
      readingCredits += c.credits;
      if (!isRequired) electiveThisSem += c.credits;
    } else {
      // 往期（含 pti 未知）计入"不含本学期"的已修。
      totalEarned += c.credits;
    }
  }

  const excludedRequiredCids = (record.requiredCidsUpToReading ?? []).filter((cid) => !taken.has(cid));

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
