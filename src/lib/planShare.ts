// 模拟选课方案分享码 —— 把当前 plan + 已修输入 + 待选 + 选班 打包成一段自包含 base64url 码（无 DB）。
// 优先用浏览器原生 CompressionStream("deflate-raw") 压缩；不支持时回退未压缩。
// 形态：`v1:<base64url>` 或 `v1z:<base64url>`（z 表示已压缩）。

export interface PlanBundle {
  v: 1;
  plan: string;
  /** localStorage["jxnu.sim.<plan>"] 的 StoredInputs 全量。 */
  inputs: Record<string, unknown>;
  /** localStorage["jxnu.cart"]，cid 数组。 */
  cart: string[];
  /** localStorage["jxnu.sim.chosenSections"]。 */
  chosen: Record<string, string>;
}

const PREFIX_PLAIN = "v1:";
const PREFIX_DEFLATE = "v1z:";

// ---------- base64url ----------
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- CompressionStream helpers（不支持则 throw） ----------
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS) throw new Error("CompressionStream not supported");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) throw new Error("DecompressionStream not supported");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DS("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- 编解码 ----------

/** 打包成自包含码（含前缀）。压缩失败自动回退未压缩。 */
export async function encodeBundle(bundle: PlanBundle): Promise<string> {
  const json = JSON.stringify(bundle);
  const raw = new TextEncoder().encode(json);
  try {
    const z = await deflate(raw);
    // 如果压缩反而更大（极短输入会发生），退回未压缩。
    if (z.length < raw.length) return PREFIX_DEFLATE + bytesToB64url(z);
  } catch {}
  return PREFIX_PLAIN + bytesToB64url(raw);
}

/** 解码自包含码 → PlanBundle；任意错误返回 null。 */
export async function decodeBundle(code: string): Promise<PlanBundle | null> {
  const trimmed = (code || "").trim();
  if (!trimmed) return null;
  let payload: Uint8Array;
  try {
    if (trimmed.startsWith(PREFIX_DEFLATE)) {
      payload = await inflate(b64urlToBytes(trimmed.slice(PREFIX_DEFLATE.length)));
    } else if (trimmed.startsWith(PREFIX_PLAIN)) {
      payload = b64urlToBytes(trimmed.slice(PREFIX_PLAIN.length));
    } else {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const obj = JSON.parse(new TextDecoder().decode(payload)) as Partial<PlanBundle>;
    if (!obj || obj.v !== 1) return null;
    if (typeof obj.plan !== "string") return null;
    if (!obj.inputs || typeof obj.inputs !== "object") return null;
    if (!Array.isArray(obj.cart)) return null;
    if (!obj.chosen || typeof obj.chosen !== "object") return null;
    return {
      v: 1,
      plan: obj.plan,
      inputs: obj.inputs as Record<string, unknown>,
      cart: (obj.cart as unknown[]).filter((x): x is string => typeof x === "string"),
      chosen: obj.chosen as Record<string, string>,
    };
  } catch {
    return null;
  }
}

/** 拼成带 ?s= 的分享链接（基于 location.origin + pathname）。 */
export function shareUrlOf(code: string): string {
  try {
    const u = new URL(window.location.href);
    u.search = `?s=${code}`;
    u.hash = "";
    return u.toString();
  } catch {
    return `?s=${code}`;
  }
}

/** 从当前 URL 取出 ?s= 参数；无则返回 null。 */
export function readCodeFromUrl(): string | null {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("s");
  } catch {
    return null;
  }
}

/** 从 URL 清除 ?s=（无刷新；恢复后调用，避免一直弹）。 */
export function clearCodeFromUrl() {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("s");
    window.history.replaceState(null, "", u.toString());
  } catch {}
}
