import type { Group, NewProfile, Platform, ProfileView, ProxyView } from '@bf/core'
import { useState } from 'react'

interface Props {
  profile: ProfileView | null
  groups: Group[]
  proxies: ProxyView[]
  hostPlatform: Platform
  error: string
  onSave: (input: NewProfile) => void
  onCancel: () => void
}

export function ProfileForm({
  profile,
  groups,
  proxies,
  hostPlatform,
  error,
  onSave,
  onCancel
}: Props): React.JSX.Element {
  const locale = navigator.language
  const [name, setName] = useState(profile?.name ?? '')
  const [groupId, setGroupId] = useState(profile?.groupId ?? '')
  const [proxyId, setProxyId] = useState(profile?.proxyId ?? '')
  const [platform, setPlatform] = useState<Platform>(profile?.platform ?? hostPlatform)
  const [lang, setLang] = useState(profile?.lang ?? locale)
  const [acceptLang, setAcceptLang] = useState(
    profile?.acceptLang ?? `${locale},${locale.split('-')[0]}`
  )
  const [timezone, setTimezone] = useState(
    profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  )
  const [cores, setCores] = useState(
    profile?.hardwareConcurrency ? String(profile.hardwareConcurrency) : ''
  )
  const [notes, setNotes] = useState(profile?.notes ?? '')

  const submit = (): void => {
    onSave({
      name: name.trim(),
      groupId: groupId || null,
      proxyId: proxyId || null,
      platform,
      lang: lang.trim(),
      acceptLang: acceptLang.trim(),
      timezone: timezone.trim(),
      hardwareConcurrency: cores ? Number(cores) : null,
      notes
    })
  }

  const valid =
    name.trim() !== '' && lang.trim() !== '' && acceptLang.trim() !== '' && timezone.trim() !== ''

  return (
    <div className="overlay">
      <div className="dialog">
        <h2>{profile ? 'Sửa hồ sơ' : 'Hồ sơ mới'}</h2>
        <div className="field">
          <label>Tên</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="IG-US-01"
          />
        </div>
        <div className="row">
          <div className="field">
            <label>Nhóm</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Chưa gán</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Proxy</label>
            <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
              <option value="">Không dùng</option>
              {proxies.map((x) => (
                <option key={x.id} value={x.id}>{`${x.protocol}://${x.host}:${x.port}`}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Hệ điều hành giả</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              <option value="macos">macOS</option>
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
            </select>
          </div>
          <div className="field">
            <label>Số nhân CPU (bỏ trống để tự sinh)</label>
            <input
              type="number"
              min="1"
              max="64"
              value={cores}
              onChange={(e) => setCores(e.target.value)}
            />
          </div>
        </div>
        {platform !== hostPlatform && (
          <p className="warn">
            Hệ điều hành giả khác máy thật: dễ lộ qua font và GPU. Chỉ dùng khi bạn hiểu rủi ro.
          </p>
        )}
        <div className="row">
          <div className="field">
            <label>Ngôn ngữ</label>
            <input value={lang} onChange={(e) => setLang(e.target.value)} placeholder="en-US" />
          </div>
          <div className="field">
            <label>Accept-Language</label>
            <input
              value={acceptLang}
              onChange={(e) => setAcceptLang(e.target.value)}
              placeholder="en-US,en"
            />
          </div>
        </div>
        <div className="field">
          <label>Múi giờ (nên khớp với vùng của proxy)</label>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/New_York"
          />
        </div>
        <div className="field">
          <label>Ghi chú</label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {profile && <p className="muted">Seed dấu vân tay: {profile.seed} (cố định)</p>}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button onClick={onCancel}>Huỷ</button>
          <button className="primary" disabled={!valid} onClick={submit}>
            Lưu
          </button>
        </div>
      </div>
    </div>
  )
}
