import { useEffect, useRef, type RefObject } from 'react'

export interface AccentChoice {
  id: string
  color: string
}

export function SettingsPopover({
  theme,
  accent,
  accents,
  persist,
  onTheme,
  onAccent,
  onPersist,
  onClose,
  triggerRef,
}: {
  theme: 'dark' | 'light'
  accent: string
  accents: AccentChoice[]
  persist: boolean
  onTheme: (theme: 'dark' | 'light') => void
  onAccent: (accent: string) => void
  onPersist: () => void
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement
    ref.current?.querySelector<HTMLElement>('button, input')?.focus()
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', escape)
      restore.current?.focus()
    }
  }, [onClose, triggerRef])

  return (
    <div ref={ref} id="settings-popover" className="settings-popover pop" role="dialog" aria-label="Settings">
      <div className="settings-section">
        <span className="settings-label">Appearance</span>
        <div className="segmented" role="group" aria-label="Theme">
          {(['dark', 'light'] as const).map((option) => (
            <button key={option} aria-pressed={theme === option} onClick={() => onTheme(option)}>
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
        <div className="settings-swatches" role="group" aria-label="Accent color">
          {accents.map((option) => (
            <button
              key={option.id}
              className="swatch"
              aria-pressed={accent === option.id}
              aria-label={`${option.id} accent`}
              onClick={() => onAccent(option.id)}
            >
              <span style={{ background: option.color }} />
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <label className="settings-toggle">
          <input type="checkbox" checked={persist} onChange={onPersist} />
          <span>Remember this buffer on this device</span>
        </label>
        <p>When off, text is removed from browser storage. Files and editor content never leave this device.</p>
      </div>
      <div className="settings-section">
        <span className="settings-label">Editor keyboard</span>
        <p><kbd className="kbd">Tab</kbd> indents by default. Press <kbd className="kbd">Ctrl M</kbd> to let Tab move focus.</p>
      </div>
    </div>
  )
}
