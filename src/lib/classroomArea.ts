// 教室代号 → 上课区域 分类。
// 同一 FormalSection 的 classroom 可能含多个教室（" / " 分隔），逐段归类后取并集。
// 优先级：上饶 > 青山湖（再按 2/6/8 子建筑细分） > 关键词类（C场/龟壳/贝壳/瑶湖体育/实验剧场/音广） > 字母前缀（W/F/X/S/L/Y/TL/A/B/C/M）。
// M 楼歧义按 section.dept 区分：含「美术」→ 超真楼；其余 → 名达楼（默认）。

export const AREAS = [
  "惟义楼",
  "名达楼",
  "超真楼",
  "方荫楼",
  "先骕楼",
  "洁琼楼",
  "天浪楼",
  "实验大楼",
  "长胜体育场",
  "瑶湖体育场",
  "瑶湖实验剧场",
  "音乐广场",
  "第二教学大楼",
  "双理楼",
  "田家炳楼",
  "青山湖校区",
  "上饶校区",
] as const;

export const OTHER_AREA = "其它";

// 校区 → 楼栋分组。用于筛选侧栏「上课区域」按校区归类渲染，
// 直观表达「青山湖校区 ⊃ 第二教学大楼/双理楼/田家炳楼」这层父子关系。
// campus 为 null 的组不渲染校区标题（用于上饶 + 「其它」这类零散桶）。
// value = 实际筛选值（须落在 AREAS / OTHER_AREA 内）；label = 显示名（默认同 value）。
export interface AreaGroup {
  campus: string | null;
  items: { value: string; label: string }[];
}

export const AREA_GROUPS: AreaGroup[] = [
  {
    campus: "瑶湖校区",
    items: [
      "惟义楼", "名达楼", "超真楼", "方荫楼", "先骕楼", "洁琼楼", "天浪楼",
      "实验大楼", "长胜体育场", "瑶湖体育场", "瑶湖实验剧场", "音乐广场",
    ].map((v) => ({ value: v, label: v })),
  },
  {
    campus: "青山湖校区",
    items: [
      { value: "第二教学大楼", label: "第二教学大楼" },
      { value: "双理楼", label: "双理楼" },
      { value: "田家炳楼", label: "田家炳楼" },
      // generic 青山湖 兜底桶（L/Y/H 等带「青」但无 2/6/8 楼号的教室）
      { value: "青山湖校区", label: "其它楼栋" },
    ],
  },
  {
    campus: null,
    items: [
      { value: "上饶校区", label: "上饶校区" },
      { value: OTHER_AREA, label: OTHER_AREA },
    ],
  },
];

// dept 子串匹配：超真名单优先（美院 M-room 走超真），其余 M-room 默认走名达。
export const CHAOZHEN_DEPT_KEYWORDS = ["美术"];

function classifyOne(room: string, dept: string): string | null {
  const s = room.trim();
  if (!s) return null;
  const lower = s.toLowerCase();

  // 1. 上饶校区（最高优先级）
  if (s.includes("上饶")) return "上饶校区";

  // 2. 青山湖校区（含「青」或 "cj"，比关键词/字母前缀都高）
  if (s.includes("青") || lower.includes("cj")) {
    // 找第一个数字 → 2/6/8 → 子建筑；其余落回「青山湖校区」兜底子项。
    const m = s.match(/\d/);
    if (m) {
      if (m[0] === "2") return "第二教学大楼";
      if (m[0] === "6") return "双理楼";
      if (m[0] === "8") return "田家炳楼";
    }
    return "青山湖校区";
  }

  // 3. 关键词类（位置/体育场专属称呼，优先于字母前缀）
  if (s.includes("C场") || s.includes("C操场") || s.includes("龟壳") || s.includes("长胜体育")) return "长胜体育场";
  if (s.includes("贝壳") || s.includes("瑶湖体育")) return "瑶湖体育场";
  if (s.includes("实验剧场")) return "瑶湖实验剧场";
  if (s.includes("音广") || s.includes("音乐广场")) return "音乐广场";

  // 4. 字母前缀（小写不敏感）
  if (lower.startsWith("tl")) return "天浪楼";
  const first = lower.charAt(0);
  if (first === "w") return "惟义楼";
  if (first === "f") return "方荫楼";
  if (first === "x") return "先骕楼";
  if (first === "s") return "洁琼楼";
  if (first === "l") return "实验大楼";
  if (first === "y") return "天浪楼";
  if (first === "a" || first === "b") return "超真楼";
  if (first === "c") return "超真楼"; // 已排除 C场/C操场
  if (first === "m") {
    if (CHAOZHEN_DEPT_KEYWORDS.some((k) => dept.includes(k))) return "超真楼";
    return "名达楼";
  }

  // 5. 兜底（A/B/V/H 之外的未知格式、纯数字、模拟、学术报告厅 等）
  return null;
}

/** 把 classroom 字符串归类到 0~N 个区域（多教室时取并集；全不匹配返回空数组 → UI 视为「其它」）。 */
export function areasOf(classroom: string, dept: string): string[] {
  if (!classroom) return [];
  const segs = classroom.split(" / ");
  const set = new Set<string>();
  for (const s of segs) {
    const a = classifyOne(s, dept);
    if (a) set.add(a);
  }
  return [...set];
}

/** 判断 section 是否落在某个 area。area === OTHER_AREA 时谓词为「未匹配任何已知区域」。 */
export function sectionInArea(areas: string[], area: string): boolean {
  if (area === OTHER_AREA) return areas.length === 0;
  return areas.includes(area);
}
