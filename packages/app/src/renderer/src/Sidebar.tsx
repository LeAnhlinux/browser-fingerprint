import type { CoreInfo } from '@bf/core'
import {
  IconFingerprint,
  IconFolders,
  IconPuzzle,
  IconSettings,
  IconUsers,
  IconWorld,
  type Icon
} from '@tabler/icons-react'
import type { ApiStatus } from './api'

export type Page = 'profiles' | 'proxies' | 'groups' | 'extensions' | 'settings'

interface Props {
  page: Page
  onNavigate: (page: Page) => void
  runningCount: number
  proxyCount: number
  groupCount: number
  extensionCount: number
  info: CoreInfo
  apiInfo: ApiStatus | null
}

export function Sidebar({
  page,
  onNavigate,
  runningCount,
  proxyCount,
  groupCount,
  extensionCount,
  info,
  apiInfo
}: Props): React.JSX.Element {
  const item = (
    id: Page,
    label: string,
    Icon: Icon,
    count?: React.ReactNode
  ): React.JSX.Element => (
    <button
      className={`nav-item${page === id ? ' active' : ''}`}
      onClick={() => onNavigate(id)}
      aria-current={page === id ? 'page' : undefined}
    >
      <Icon size={17} stroke={1.75} />
      {label}
      {count}
    </button>
  )

  const apiLine =
    apiInfo === null ? null : apiInfo.running ? (
      <span className="line">
        <span className="dot ok" style={{ width: 6, height: 6, boxShadow: 'none' }} />
        API :{apiInfo.port}
      </span>
    ) : (
      <span className="line">
        <span className="dot fail" style={{ width: 6, height: 6 }} />
        {apiInfo.enabled ? 'API lỗi' : 'API tắt'}
      </span>
    )

  return (
    <nav className="sidebar" aria-label="Điều hướng">
      <div className="brand">
        <span className="brand-mark">
          <IconFingerprint size={18} />
        </span>
        <span>
          Browser Fingerprint
          <small>Hồ sơ trình duyệt tách biệt</small>
        </span>
      </div>
      {item(
        'profiles',
        'Hồ sơ',
        IconUsers,
        runningCount > 0 ? <span className="count live">{runningCount} đang chạy</span> : undefined
      )}
      {item('proxies', 'Proxy', IconWorld, <span className="count">{proxyCount}</span>)}
      {item('groups', 'Nhóm', IconFolders, <span className="count">{groupCount}</span>)}
      {item('extensions', 'Extension', IconPuzzle, <span className="count">{extensionCount}</span>)}
      <div className="sidebar-spacer" />
      {item('settings', 'Cài đặt', IconSettings)}
      <div className="sidebar-foot">
        {apiLine}
        <span className="line">Nhân {info.engineVersion}</span>
      </div>
    </nav>
  )
}
