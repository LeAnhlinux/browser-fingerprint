import type { ProfileView, ProxyView } from '@bf/core'
import { IconAlertTriangle, IconX } from '@tabler/icons-react'
import { useEffect, type ReactNode } from 'react'

/** Đóng bằng phím Esc, trừ khi đang bận. */
function useEscape(onClose: () => void, disabled = false): void {
  useEffect(() => {
    if (disabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, disabled])
}

export function Drawer({
  onClose,
  busy = false,
  children
}: {
  onClose: () => void
  busy?: boolean
  children: ReactNode
}): React.JSX.Element {
  useEscape(onClose, busy)
  return (
    <>
      <div className="backdrop" onClick={busy ? undefined : onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        {children}
      </aside>
    </>
  )
}

export function Modal({
  title,
  onClose,
  busy = false,
  footer,
  children
}: {
  title: string
  onClose: () => void
  busy?: boolean
  footer: ReactNode
  children: ReactNode
}): React.JSX.Element {
  useEscape(onClose, busy)
  return (
    <>
      <div className="backdrop" />
      <div className="modal-wrap" onClick={busy ? undefined : onClose}>
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>{title}</h2>
            <CloseButton onClick={onClose} disabled={busy} />
          </div>
          <div className="modal-body">{children}</div>
          <div className="modal-foot">{footer}</div>
        </div>
      </div>
    </>
  )
}

export function CloseButton({
  onClick,
  disabled = false
}: {
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button className="icon-btn" aria-label="Đóng" disabled={disabled} onClick={onClick}>
      <IconX size={16} />
    </button>
  )
}

export function Banner({
  kind,
  children,
  onClose
}: {
  kind: 'error' | 'ok' | 'info' | 'warn'
  children: ReactNode
  onClose?: () => void
}): React.JSX.Element {
  return (
    <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'error' && <IconAlertTriangle size={16} style={{ marginTop: 1 }} />}
      <div className="grow">{children}</div>
      {onClose && (
        <button className="icon-btn" aria-label="Ẩn thông báo" onClick={onClose}>
          <IconX size={14} />
        </button>
      )}
    </div>
  )
}

export function RunStatus({ profile }: { profile: ProfileView }): React.JSX.Element {
  if (!profile.run)
    return (
      <span className="pill">
        <span className="dot idle" />
        Sẵn sàng
      </span>
    )
  if (profile.run.headless)
    return (
      <span className="pill accent">
        <span className="dot accent" />
        Đang chạy ẩn
      </span>
    )
  return (
    <span className="pill ok">
      <span className="dot ok" />
      Đang chạy
    </span>
  )
}

export function ProxyStatus({
  proxy,
  checking = false,
  error
}: {
  proxy: ProxyView
  checking?: boolean
  error?: string
}): React.JSX.Element {
  if (checking)
    return (
      <span className="pill accent">
        <span className="dot accent" />
        Đang kiểm tra…
      </span>
    )
  if (error)
    return (
      <span className="pill fail" title={error}>
        <span className="dot fail" />
        {error}
      </span>
    )
  if (proxy.lastStatus === 'ok')
    return (
      <span className="pill ok">
        <span className="dot ok" />
        {[proxy.lastIp, proxy.lastCountry, proxy.lastTimezone].filter(Boolean).join(' · ') ||
          'Sống'}
      </span>
    )
  if (proxy.lastStatus === 'fail')
    return (
      <span className="pill fail" title={proxy.lastError ?? undefined}>
        <span className="dot fail" />
        {proxy.lastError ?? 'Không kết nối được'}
      </span>
    )
  return (
    <span className="pill">
      <span className="dot idle" />
      Chưa kiểm tra
    </span>
  )
}
