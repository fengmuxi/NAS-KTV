import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';

/* Hallmark · component: searchable-select · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 */

export interface SearchableSelectOption {
  value: string;
  label: string;
  group?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  label?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** 允许创建新选项：搜索词无精确匹配时显示「回车创建」提示 */
  creatable?: boolean;
  /** 创建回调：输入词不在 options 中时回车触发（仅 creatable 时有效） */
  onCreate?: (label: string) => void;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '请选择',
  label,
  multiple = false,
  disabled = false,
  creatable = false,
  onCreate,
}: SearchableSelectProps) {
  const generatedId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedValues = useMemo(() => {
    if (!value) return [] as string[];
    return Array.isArray(value) ? value : [value];
  }, [value]);

  const selectedLabels = useMemo(() => {
    const map = new Map(options.map(o => [o.value, o.label]));
    return selectedValues.map(v => map.get(v) ?? v);
  }, [selectedValues, options]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, search]);

  // 可创建模式：输入词非空且不存在精确同名选项时，允许回车创建新项
  const trimmedSearch = search.trim();
  const canCreate =
    creatable &&
    trimmedSearch.length > 0 &&
    !options.some(o => o.label.toLowerCase() === trimmedSearch.toLowerCase());

  const grouped = useMemo(() => {
    const groups: { group: string | null; items: { option: SearchableSelectOption; globalIndex: number }[] }[] = [];
    const groupMap = new Map<string | null, { option: SearchableSelectOption; globalIndex: number }[]>();
    for (let i = 0; i < filtered.length; i++) {
      const g = filtered[i].group ?? null;
      if (!groupMap.has(g)) groupMap.set(g, []);
      groupMap.get(g)!.push({ option: filtered[i], globalIndex: i });
    }
    for (const [group, items] of groupMap) {
      groups.push({ group, items });
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggleValue = (val: string) => {
    if (multiple) {
      const next = selectedValues.includes(val)
        ? selectedValues.filter(v => v !== val)
        : [...selectedValues, val];
      onChange(next);
    } else {
      onChange(val);
      setOpen(false);
      setSearch('');
    }
  };

  const removeValue = (val: string) => {
    if (multiple) {
      onChange(selectedValues.filter(v => v !== val));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (canCreate) {
          // 输入了不存在的新项：触发创建回调，随后关闭并清空输入
          onCreate?.(trimmedSearch);
          setSearch('');
          setOpen(false);
          return;
        }
        if (activeIndex >= 0 && activeIndex < filtered.length) {
          toggleValue(filtered[activeIndex].value);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        setActiveIndex(i => (i < filtered.length - 1 ? i + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(i => (i > 0 ? i - 1 : filtered.length - 1));
        break;
      case 'Escape':
        setOpen(false);
        setSearch('');
        break;
      case 'Backspace':
        if (multiple && search === '' && selectedValues.length > 0) {
          removeValue(selectedValues[selectedValues.length - 1]);
        }
        break;
    }
  };

  const displayText = useMemo(() => {
    if (open) return search;
    if (multiple) return '';
    return selectedLabels[0] ?? '';
  }, [open, search, multiple, selectedLabels]);

  return (
    <div className="w-full" ref={containerRef}>
      {label && (
        <label
          htmlFor={generatedId}
          className="block text-sm font-medium text-ink-2 mb-xs"
        >
          {label}
        </label>
      )}
      <div
        className={[
          'relative rounded-md border bg-paper text-sm transition-colors duration-150',
          'border-border hover:border-border-strong',
          open
            ? 'border-accent ring-2 ring-[color-mix(in_oklch,var(--color-accent)_25%,transparent)]'
            : '',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 min-h-[36px]">
          {multiple && selectedValues.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedValues.map((v, i) => (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 text-accent text-xs font-medium"
                >
                  {selectedLabels[i]}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        removeValue(v);
                      }}
                      className="hover:text-accent/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
                      aria-label={`移除 ${selectedLabels[i]}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="flex-1 min-w-[60px] flex items-center gap-1">
            <Search className="w-3.5 h-3.5 text-ink-3 shrink-0" />
            <input
              ref={inputRef}
              id={generatedId}
              type="text"
              className="w-full bg-transparent text-ink text-sm focus-visible:outline-none placeholder:text-ink-3"
              placeholder={multiple && selectedValues.length > 0 ? '继续搜索...' : placeholder}
              value={displayText}
              onChange={e => {
                setSearch(e.target.value);
                if (!open) setOpen(true);
              }}
              onFocus={() => {
                if (!disabled) {
                  setOpen(true);
                  setSearch('');
                }
              }}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
            />
          </div>
          <ChevronDown
            className={[
              'w-4 h-4 text-ink-3 shrink-0 transition-transform',
              open ? 'rotate-180' : '',
            ].join(' ')}
          />
        </div>

        {open && filtered.length > 0 && (
          <ul
            ref={listRef}
            className="absolute z-50 left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-paper shadow-lg"
            role="listbox"
          >
            {grouped.map(({ group, items }) => (
              <li key={group ?? '__ungrouped'}>
                {group && (
                  <div className="px-3 py-1.5 text-xs font-semibold text-ink-3 bg-paper-2 sticky top-0">
                    {group}
                  </div>
                )}
                {items.map(({ option, globalIndex }) => {
                  const isSelected = selectedValues.includes(option.value);
                  return (
                    <div
                      key={option.value}
                      data-index={globalIndex}
                      role="option"
                      aria-selected={isSelected}
                      className={[
                        'px-3 py-2 text-sm cursor-pointer transition-colors',
                        'hover:bg-paper-3',
                        globalIndex === activeIndex ? 'bg-paper-3' : '',
                        isSelected ? 'text-accent font-medium' : 'text-ink',
                      ].join(' ')}
                      onClick={() => toggleValue(option.value)}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                    >
                      {multiple && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="mr-2 accent-accent w-3.5 h-3.5 align-middle"
                        />
                      )}
                      {option.label}
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        )}

        {open && filtered.length === 0 && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border border-border bg-paper shadow-lg px-3 py-4 text-center text-sm text-ink-3">
            {canCreate ? (
              <span>
                回车创建「<span className="font-medium text-accent">{trimmedSearch}</span>」
              </span>
            ) : (
              '无匹配结果'
            )}
          </div>
        )}
      </div>
    </div>
  );
}
