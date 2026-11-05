"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Side drawer (non-modal dialog). It stays mounted while closed, so the
 * state of everything inside (open sections, scroll position) survives.
 * Escape closes it. Focus moves to the heading on open and back to the
 * opener on close.
 */
export function Drawer({
  id,
  title,
  subtitle,
  open,
  onClose,
  widthClass,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  widthClass: string;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement;
      headingRef.current?.focus();
    } else if (openerRef.current instanceof HTMLElement) {
      openerRef.current.focus();
      openerRef.current = null;
    }
  }, [open]);

  return (
    <aside
      id={id}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      hidden={!open}
      data-testid={id}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className={`fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-surface shadow-2xl ${widthClass}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="text-base font-semibold focus:outline-none focus-visible:underline">
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p> : null}
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-surface-raised" data-testid={`${id}-close`}>
          {"Close"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
