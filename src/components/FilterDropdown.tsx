"use client"
import React, { useState, useEffect, useRef } from 'react';

export interface DropdownOption { value: string; label: string; }

interface FilterDropdownProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  // Called each time the menu opens (e.g. to retry loading empty options).
  onOpen?: () => void;
}

const FilterDropdown: React.FC<FilterDropdownProps> = ({ label, value, options, onChange, onOpen }) => {
  const [open, setOpen] = useState(false);
  // Right-align the menu when the button sits in the right half of the
  // viewport so it opens leftwards instead of running off a phone screen.
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // The menu's side is measured when it opens; close it on resize/rotation
  // rather than leave it aligned for the old width
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    setAlignRight(!!rect && rect.left + rect.width / 2 > window.innerWidth / 2);
    setOpen(true);
    onOpen?.();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <span>{selected ? selected.label : label}</span>
        {value && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="ml-1 text-gray-400 hover:text-red-500 transition-colors leading-none"
            aria-label="Clear"
          >✕</span>
        )}
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`absolute ${alignRight ? 'right-0 left-auto' : 'left-0'} mt-1 z-40 w-52 max-w-[calc(100vw-2rem)] max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg scrollbar-hide`}>
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${!value ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-white font-semibold' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            {label}
          </button>
          {options.map(opt => (
            <button
              type="button"
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${value === opt.value ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-white font-semibold' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FilterDropdown;
