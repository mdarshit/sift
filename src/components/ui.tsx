import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Icons (16px stroke icons, no icon font)
// ---------------------------------------------------------------------------

const paths: Record<string, ReactNode> = {
  chevronDown: <path d="M4 6l4 4 4-4" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  braces: (
    <path d="M5.5 2.5c-1.4 0-2 .7-2 1.9v1.8c0 .9-.5 1.3-1.4 1.3.9 0 1.4.4 1.4 1.3v1.8c0 1.2.6 1.9 2 1.9M10.5 2.5c1.4 0 2 .7 2 1.9v1.8c0 .9.5 1.3 1.4 1.3-.9 0-1.4.4-1.4 1.3v1.8c0 1.2-.6 1.9-2 1.9" />
  ),
  shrink: <path d="M6.5 2v4.5H2M9.5 2v4.5H14M6.5 14V9.5H2M9.5 14V9.5H14" />,
  mask: (
    <>
      <path d="M2 2l12 12" />
      <path d="M4.9 4.9C3 6 1.8 8 1.8 8s2.3 4.2 6.2 4.2c1 0 1.9-.3 2.7-.7M6.7 3.2c.4-.1.9-.2 1.3-.2 3.9 0 6.2 4.2 6.2 4.2s-.6 1.1-1.7 2.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" />
    </>
  ),
  moon: <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" />,
  graph: (
    <>
      <rect x="1.5" y="6" width="4.5" height="4" rx="1" />
      <rect x="10" y="2" width="4.5" height="4" rx="1" />
      <rect x="10" y="10" width="4.5" height="4" rx="1" />
      <path d="M6 7.5c2.5 0 1.5-3.5 4-3.5M6 8.5c2.5 0 1.5 3.5 4 3.5" />
    </>
  ),
  compare: (
    <>
      <path d="M2.5 3.5h4M2.5 6.5h5M2.5 9.5h4M9.5 3.5h4M8.5 6.5h5M9.5 9.5h4" />
      <path d="M6.5 12.5h3M8 11v3" />
    </>
  ),
  swap: <path d="M4 4h7.5l-2-2M12 12H4.5l2 2M11.5 4 14 6.5 11.5 9M4.5 12 2 9.5 4.5 7" />,
  tree: (
    <>
      <path d="M3 3.5h3M5 3.5v9M5 7.8h3M5 12.5h3" />
      <rect x="8" y="6.3" width="5" height="3" rx=".7" />
      <rect x="8" y="11" width="5" height="3" rx=".7" />
    </>
  ),
  structure: (
    <>
      <path d="M6 3.5h7.5M8.5 8h5M8.5 12.5h5" />
      <path d="M3.5 3.5v9h2.5M3.5 8h2.5" />
    </>
  ),
  chevronRight: <path d="M6 4l4 4-4 4" />,
  keyboard: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M4 6.6h0M6.5 6.6h0M9 6.6h0M11.5 6.6h0M4.5 9.4h7" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />
    </>
  ),
  undo: <path d="M6 5H2.5m0 0L5 2.5M2.5 5l2.5 2.5M3 5h6a4 4 0 0 1 0 8H6.5" />,
  redo: <path d="M10 5h3.5m0 0L11 2.5M13.5 5 11 7.5M13 5H7a4 4 0 0 0 0 8h2.5" />,
  more: (
    <>
      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
}

export function Icon({ name, size = 15, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Dropdown menu (keyboard operable, restores focus to its trigger)
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string
  separatorAbove?: boolean
  onClick: () => void
}

export function Menu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    })
  }, [x, y])

  // role="menu" promises keyboard operation: focus moves in on open…
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  // …and arrows move between items.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    if (buttons.length === 0) return
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      buttons[(idx + 1) % buttons.length].focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(idx - 1 + buttons.length) % buttons.length].focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      buttons[0].focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      buttons[buttons.length - 1].focus()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="pop fixed z-50 min-w-44 rounded-lg border border-border bg-panel py-1 shadow-[var(--shadow)]"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorAbove && <div className="my-1 border-t border-border" />}
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 whitespace-pre px-3 py-1.5 text-left font-mono text-[12px] text-ink hover:bg-hover"
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}

/** Hook for anchored dropdown menus. */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const openFor = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    trigger.current = e.currentTarget as HTMLElement
    const target = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: target.left, y: target.bottom + 4, items })
  }
  const close = () => {
    setMenu(null)
    trigger.current?.focus()
    trigger.current = null
  }
  const element = menu ? <Menu {...menu} onClose={close} /> : null
  return { openFor, element }
}

// ---------------------------------------------------------------------------
// Keyboard-shortcuts dialog (modal: Esc closes, focus trapped, focus restored)
// ---------------------------------------------------------------------------

export interface Shortcut {
  keys: string[]
  label: string
}

export function ShortcutsDialog({ shortcuts, onClose }: { shortcuts: Shortcut[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  // Remember what had focus, move focus in, restore it on unmount.
  useEffect(() => {
    restore.current = document.activeElement as HTMLElement
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => restore.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab') {
        e.preventDefault() // one control in here — keep focus on it
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="dialog w-full max-w-sm rounded-xl border border-border bg-panel shadow-[var(--shadow)]"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="font-mono text-[13px] font-semibold">Keyboard shortcuts</h2>
          <button className="icon-btn h-7 w-7" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="p-2">
          {shortcuts.map((s) => (
            <div key={s.label} className="flex items-center justify-between rounded-lg px-3 py-2">
              <span className="text-[13px] text-ink">{s.label}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <kbd key={i} className="kbd">
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="spin" aria-label="Loading">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}
