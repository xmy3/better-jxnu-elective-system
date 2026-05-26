import { useEffect } from "react";
import { createPortal } from "react-dom";

// 通用确认框。Portal 到 body：sim 面板祖先有 transform，普通 fixed 会被劫持包含块。
// 遮罩点击 / Esc = 取消。

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmText = "确认", cancelText = "取消", onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div
        className="relative bg-white rounded-2xl shadow-xl w-[340px] max-w-[90vw] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold text-gray-900 text-center">{title}</h3>
        {message && (
          <p className="mt-2.5 text-[12px] text-gray-500 text-center leading-relaxed">{message}</p>
        )}
        <div className="flex gap-3 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 active:bg-red-700 transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
