// 模拟选课「待选清单」store —— module-level 订阅范式（参照 ratingsStore.ts）。
// 内容是一组 courseId，localStorage 持久化；刷新页面不丢。
// 通过 useSyncExternalStore 在组件间共享同一份状态。

type Listener = () => void;

const STORAGE_KEY = "jxnu.cart";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set<string>(JSON.parse(raw));
  } catch {}
  return new Set<string>();
}

const cart = load();
const listeners = new Set<Listener>();
// useSyncExternalStore 要求 getSnapshot 返回稳定引用：仅在数据变更时换新数组。
let snapshot: string[] = [...cart];

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cart]));
  } catch {}
}

function notify() {
  snapshot = [...cart];
  for (const fn of listeners) fn();
}

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCartSnapshot(): string[] {
  return snapshot;
}

export function isInCart(id: string): boolean {
  return cart.has(id);
}

export function toggleCart(id: string) {
  if (cart.has(id)) cart.delete(id);
  else cart.add(id);
  persist();
  notify();
}

export function removeFromCart(id: string) {
  if (cart.has(id)) {
    cart.delete(id);
    persist();
    notify();
  }
}

export function clearCart() {
  if (cart.size > 0) {
    cart.clear();
    persist();
    notify();
  }
}

// 整体替换（方案分享码恢复用）；传空数组 = 清空。
export function setCart(ids: string[]) {
  cart.clear();
  for (const id of ids) cart.add(id);
  persist();
  notify();
}
