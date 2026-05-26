import { useSyncExternalStore, useMemo } from "react";
import {
  subscribe,
  getCartSnapshot,
  toggleCart,
  removeFromCart,
  clearCart,
  setCart,
} from "../lib/cartStore";

/** 订阅待选清单 store。返回当前 id 列表 + 操作方法，跨组件共享同一份状态。 */
export function useCart() {
  const ids = useSyncExternalStore(subscribe, getCartSnapshot, getCartSnapshot);
  const set = useMemo(() => new Set(ids), [ids]);
  return {
    ids,
    count: ids.length,
    has: (id: string) => set.has(id),
    toggle: toggleCart,
    remove: removeFromCart,
    clear: clearCart,
    setAll: setCart,
  };
}
