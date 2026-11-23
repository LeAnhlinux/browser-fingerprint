import type { Extension, Group, Platform, ProfileInput, ProfileView, ProxyView } from '@bf/core'
import { IconAdjustments, IconCookie, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react'
import { useState } from 'react'
import { CookiePanel } from './CookiePanel'
import { ProfileForm } from './ProfileForm'
import { CloseButton, Drawer, RunStatus } from './ui'

export type DrawerTab = 'settings' | 'cookies'

interface Props {
  profile: ProfileView | null
  tab: DrawerTab
  onTab: (tab: DrawerTab) => void
  groups: Group[]
  proxies: ProxyView[]
  extensions: Extension[]
  groupExtensions: Record<string, string[]>
  hostPlatform: Platform
  error: string
  saving: boolean
  pending: boolean
  onSave: (input: ProfileInput) => void
  onDelete: () => void
  onStart: () => void
  onStop: () => void
  onClose: () => void
}

export function ProfileDrawer(props: Props): React.JSX.Element {
  const { profile, tab, onTab, saving, pending, onClose } = props
  const [cookieBusy, setCookieBusy] = useState(false)
  const busy = saving || cookieBusy

  return (
    <Drawer onClose={onClose} busy={busy}>
      <div className="drawer-head" style={profile ? undefined : { paddingBottom: 4 }}>
        <div className="drawer-title">
          <h2>{profile ? profile.name : 'Hồ sơ mới'}</h2>
          {profile && <RunStatus profile={profile} />}
          {profile &&
            (profile.run ? (
              <button className="btn sm" disabled={pending || busy} onClick={props.onStop}>
                <IconPlayerStop size={14} />
                Dừng
              </button>
            ) : (
              <button className="btn primary sm" disabled={pending || busy} onClick={props.onStart}>
                <IconPlayerPlay size={14} />
                Khởi động
              </button>
            ))}
          <CloseButton onClick={onClose} disabled={busy} />
        </div>
        {profile && (
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'settings'}
              className={`tab${tab === 'settings' ? ' active' : ''}`}
              disabled={busy}
              onClick={() => onTab('settings')}
            >
              <IconAdjustments size={15} />
              Thiết lập
            </button>
            <button
              role="tab"
              aria-selected={tab === 'cookies'}
              className={`tab${tab === 'cookies' ? ' active' : ''}`}
              disabled={busy}
              onClick={() => onTab('cookies')}
            >
              <IconCookie size={15} />
              Cookie
            </button>
          </div>
        )}
      </div>
      {profile && tab === 'cookies' ? (
        <CookiePanel key={profile.id} profile={profile} onBusyChange={setCookieBusy} />
      ) : (
        <ProfileForm
          key={profile?.id ?? 'new'}
          profile={profile}
          groups={props.groups}
          proxies={props.proxies}
          extensions={props.extensions}
          groupExtensions={props.groupExtensions}
          hostPlatform={props.hostPlatform}
          error={props.error}
          saving={saving}
          onSave={props.onSave}
          onCancel={onClose}
          onDelete={profile ? props.onDelete : undefined}
        />
      )}
    </Drawer>
  )
}
