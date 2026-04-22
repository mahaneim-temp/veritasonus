import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 클래스를 조건부 병합. shadcn/ui 컨벤션. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
