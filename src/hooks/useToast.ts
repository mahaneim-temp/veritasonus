"use client";

import { useSyncExternalStore } from "react";

interface Toast {
  id: string;
  title: string;
  description?: string;
  tone?: "info" | "success" | "warning" | "danger";
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function pushToast(t: Omit<Toast, "id">) {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, ...t }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  }, 4000);
}

export function useToast(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => [],
  );
}
