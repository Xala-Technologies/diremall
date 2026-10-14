import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type FilterOption = {
  value: string;
  label: string;
  icon: ReactNode;
};

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  title,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.focus();
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (direction: 1 | -1) => {
    const items = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="option"]',
      ) ?? []),
    ];
    if (!items.length) return;
    const index = items.findIndex((item) => item === document.activeElement);
    const next =
      items[index + direction] ?? items[direction === 1 ? 0 : items.length - 1];
    next?.focus();
  };

  return (
    <div
      className={`filter-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="filter-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        title={title}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span className="filter-select-icon" aria-hidden="true">
          {selected?.icon}
        </span>
        <span className="filter-select-value">{selected?.label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          className="filter-select-menu"
          role="listbox"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="filter-select-option"
              onClick={() => choose(option.value)}
            >
              <span className="filter-select-icon" aria-hidden="true">
                {option.icon}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
