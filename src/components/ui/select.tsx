"use client";

import * as React from "react";
import * as RS from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const Select = RS.Root;
export const SelectValue = RS.Value;

export const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof RS.Trigger>
>(({ className, children, ...props }, ref) => (
  <RS.Trigger
    ref={ref}
    className={cn(
      "flex h-11 w-full items-center justify-between rounded-xl border border-border-strong bg-surface px-3.5 text-sm",
      "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
      className,
    )}
    {...props}
  >
    {children}
    <RS.Icon asChild>
      <ChevronDown className="h-4 w-4 text-ink-muted" />
    </RS.Icon>
  </RS.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof RS.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <RS.Portal>
    <RS.Content
      ref={ref}
      position={position}
      className={cn(
        "z-50 min-w-[12rem] overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-md",
        className,
      )}
      sideOffset={4}
      {...props}
    >
      <RS.Viewport className="p-1">{children}</RS.Viewport>
    </RS.Content>
  </RS.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof RS.Item>
>(({ className, children, ...props }, ref) => (
  <RS.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-lg px-3 py-2 text-sm outline-none",
      "data-[state=checked]:bg-primary/10 data-[highlighted]:bg-elev",
      className,
    )}
    {...props}
  >
    <RS.ItemText>{children}</RS.ItemText>
    <RS.ItemIndicator className="ml-auto">
      <Check className="h-4 w-4 text-primary" />
    </RS.ItemIndicator>
  </RS.Item>
));
SelectItem.displayName = "SelectItem";
