import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function ModeCard({
  href,
  title,
  description,
  icon: Icon,
  disabled,
  badge,
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  disabled?: boolean;
  badge?: string;
}) {
  const content = (
    <div
      className={cn(
        "group relative h-full rounded-2xl border border-border-subtle bg-surface p-6 transition-all",
        !disabled &&
          "hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 cursor-pointer",
        disabled && "opacity-60",
      )}
    >
      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold text-ink-primary">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
        {description}
      </p>
      {badge && (
        <span className="absolute top-4 right-4 rounded-full bg-elev px-2 py-0.5 text-[10px] font-medium text-ink-secondary">
          {badge}
        </span>
      )}
    </div>
  );

  if (disabled) return <div aria-disabled>{content}</div>;
  return (
    <Link href={href} aria-label={title}>
      {content}
    </Link>
  );
}
