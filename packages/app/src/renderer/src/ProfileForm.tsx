import type { Extension, Group, Platform, ProfileInput, ProfileView, ProxyView } from '@bf/core'
import { IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { FingerprintCard } from './FingerprintCard'
import { SCREEN_PRESETS, proxyOption } from './format'
import { Banner } from './ui'

interface Props {
  profile: ProfileView | null
  groups: Group[]
  proxies: ProxyView[]
  extensions: Extension[]
  groupExtensions: Record<string, string[]>
  hostPlatform: Platform
  error: string
  saving: boolean
  onSave: (input: ProfileInput) => void
  onCancel: () => void
  onDelete?: () => void
}

const PLATFORM_LABEL: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux'
}

export function ProfileForm({
  profile,
  groups,
  proxies,
  extensions,
  groupExtensions,
  hostPlatform,
  error,
  saving,
  onSave,
  onCancel,
  onDelete
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
  const [screenW, setScreenW] = useState(profile?.screenWidth ? String(profile.screenWidth) : '')
  const [screenH, setScreenH] = useState(profile?.screenHeight ? String(profile.screenHeight) : '')
  const [screenScale, setScreenScale] = useState(String(profile?.screenScale ?? 1))
  const [customScreen, setCustomScreen] = useState(false)
  const [notes, setNotes] = useState(profile?.notes ?? '')
  const [extIds, setExtIds] = useState<Set<string>>(new Set(profile?.extensionIds ?? []))

  const running = profile?.run != null
  const proxy = proxies.find((x) => x.id === proxyId)
  const proxyTz = proxy?.lastStatus === 'ok' ? proxy.lastTimezone : null

  const presets = SCREEN_PRESETS[platform]
  const hasScreen = screenW !== '' && screenH !== ''
  const presetIndex = hasScreen
    ? presets.findIndex(
        (x) =>
          String(x.width) === screenW &&
          String(x.height) === screenH &&
          String(x.scale) === screenScale
      )
    : -1
  const screenChoice =
    !hasScreen && !customScreen
      ? 'real'
      : presetIndex >= 0 && !customScreen
        ? String(presetIndex)
        : 'custom'
  const pickScreen = (v: string): void => {
    if (v === 'real') {
      setCustomScreen(false)
      setScreenW('')
      setScreenH('')
      setScreenScale('1')
    } else if (v === 'custom') {
      setCustomScreen(true)
      if (!hasScreen) {
        setScreenW('1920')
        setScreenH('1080')
      }
    } else {
      const x = presets[Number(v)]
      setCustomScreen(false)
      setScreenW(String(x.width))
      setScreenH(String(x.height))
      setScreenScale(String(x.scale))
    }
  }
  const fpDirty =
    profile !== null &&
    (platform !== profile.platform ||
      (cores ? Number(cores) : null) !== profile.hardwareConcurrency ||
      lang.trim() !== profile.lang ||
      acceptLang.trim() !== profile.acceptLang ||
      timezone.trim() !== profile.timezone)

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
      screenWidth: hasScreen ? Number(screenW) : null,
      screenHeight: hasScreen ? Number(screenH) : null,
      screenScale: hasScreen ? Number(screenScale) : null,
      notes,
      extensionIds: extensions.filter((x) => extIds.has(x.id)).map((x) => x.id)
    })
  }

  const screenOk =
    !hasScreen ||
    (Number.isInteger(Number(screenW)) &&
      Number(screenW) >= 320 &&
      Number(screenW) <= 7680 &&
      Number.isInteger(Number(screenH)) &&
      Number(screenH) >= 240 &&
      Number(screenH) <= 4320)
  const valid =
    !saving &&
    screenOk &&
    (screenW === '') === (screenH === '') &&
    name.trim() !== '' &&
    lang.trim() !== '' &&
    acceptLang.trim() !== '' &&
    timezone.trim() !== ''

  return (
    <>
      <div className="drawer-body">
        {error && <Banner kind="error">{error}</Banner>}
        {running && (
          <Banner kind="info">
            Hồ sơ đang chạy: thay đổi về proxy, dấu vân tay và extension có hiệu lực từ lần khởi
            động sau.
          </Banner>
        )}

        <section className="section">
          <h3>Cơ bản</h3>
          <div className="field">
            <label htmlFor="pf-name">Tên</label>
            <input
              id="pf-name"
              autoFocus={!profile}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="IG-US-01"
            />
          </div>
          <div className="field">
            <label htmlFor="pf-group">Nhóm</label>
            <select id="pf-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Chưa gán</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-notes">Ghi chú</label>
            <textarea
              id="pf-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tài khoản, mật khẩu ví, việc cần làm…"
            />
          </div>
        </section>

        <section className="section">
          <h3>Mạng</h3>
          <div className="field">
            <label htmlFor="pf-proxy">Proxy</label>
            <select id="pf-proxy" value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
              <option value="">Không dùng (kết nối trực tiếp bằng IP thật)</option>
              {proxies.map((x) => (
                <option key={x.id} value={x.id}>
                  {proxyOption(x)}
                </option>
              ))}
            </select>
            {proxies.length === 0 && (
              <span className="hint">Chưa có proxy nào. Thêm ở trang Proxy.</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="pf-tz">Múi giờ</label>
            <input
              id="pf-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
            />
            {proxyTz && proxyTz !== timezone ? (
              <button className="link-btn" type="button" onClick={() => setTimezone(proxyTz)}>
                Dùng múi giờ của proxy: {proxyTz}
              </button>
            ) : (
              <span className="hint">Nên khớp với vùng của proxy.</span>
            )}
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="pf-lang">Ngôn ngữ</label>
              <input
                id="pf-lang"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                placeholder="en-US"
              />
            </div>
            <div className="field">
              <label htmlFor="pf-al">Accept-Language</label>
              <input
                id="pf-al"
                value={acceptLang}
                onChange={(e) => setAcceptLang(e.target.value)}
                placeholder="en-US,en"
              />
            </div>
          </div>
        </section>

        <section className="section">
          <h3>Dấu vân tay</h3>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="pf-os">Hệ điều hành giả</label>
              <select
                id="pf-os"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
              >
                {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pf-cores">Số nhân CPU</label>
              <input
                id="pf-cores"
                type="number"
                min="1"
                max="128"
                value={cores}
                onChange={(e) => setCores(e.target.value)}
                placeholder="Tự sinh"
              />
            </div>
          </div>
          {platform !== hostPlatform && (
            <Banner kind="warn">
              Hệ điều hành giả khác máy thật ({PLATFORM_LABEL[hostPlatform]}): dễ lộ qua font và
              GPU. Chỉ dùng khi bạn hiểu rủi ro.
            </Banner>
          )}
          <div className="field">
            <label htmlFor="pf-screen">Màn hình</label>
            <select
              id="pf-screen"
              value={screenChoice}
              onChange={(e) => pickScreen(e.target.value)}
            >
              <option value="real">Màn hình thật của máy (không giả)</option>
              {presets.map((x, i) => (
                <option key={x.label} value={String(i)}>
                  {x.label}
                </option>
              ))}
              <option value="custom">Tự nhập…</option>
            </select>
            {screenChoice === 'custom' && (
              <div className="grid-3" style={{ marginTop: 8 }}>
                <input
                  aria-label="Chiều rộng màn hình"
                  type="number"
                  min="320"
                  max="7680"
                  value={screenW}
                  onChange={(e) => setScreenW(e.target.value)}
                  placeholder="Rộng"
                />
                <input
                  aria-label="Chiều cao màn hình"
                  type="number"
                  min="240"
                  max="4320"
                  value={screenH}
                  onChange={(e) => setScreenH(e.target.value)}
                  placeholder="Cao"
                />
                <select
                  aria-label="Tỉ lệ điểm ảnh"
                  value={screenScale}
                  onChange={(e) => setScreenScale(e.target.value)}
                >
                  {['1', '1.25', '1.5', '1.75', '2', '3'].map((v) => (
                    <option key={v} value={v}>
                      Tỉ lệ {v}×
                    </option>
                  ))}
                </select>
              </div>
            )}
            <span className="hint">
              {hasScreen
                ? 'Để giả màn hình, hồ sơ này tắt tính năng cách ly trang theo tên miền của Chromium: kém an toàn hơn một chút trước trang độc hại.'
                : 'Trang web sẽ thấy độ phân giải màn hình thật của máy bạn.'}
            </span>
          </div>
          {profile ? (
            <FingerprintCard profile={profile} dirty={fpDirty} />
          ) : (
            <p className="faint">
              GPU, CPU, RAM do nhân chọn theo một seed ngẫu nhiên. Sau khi tạo, mở lại hồ sơ để xem
              trang web sẽ thấy gì.
            </p>
          )}
        </section>

        {extensions.length > 0 && (
          <section className="section">
            <h3>Extension</h3>
            <div className="check-grid">
              {extensions.map((ext) => {
                const fromGroup = (groupExtensions[groupId] ?? []).includes(ext.id)
                return (
                  <label key={ext.id} title={fromGroup ? 'Được gán qua nhóm' : undefined}>
                    <input
                      type="checkbox"
                      disabled={fromGroup}
                      checked={fromGroup || extIds.has(ext.id)}
                      onChange={(e) =>
                        setExtIds((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(ext.id)
                          else next.delete(ext.id)
                          return next
                        })
                      }
                    />
                    <span>
                      {ext.name}
                      {fromGroup && <span className="faint"> · từ nhóm</span>}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        )}
      </div>
      <div className="drawer-foot">
        {onDelete && (
          <button
            className="btn danger sm"
            disabled={saving || running}
            title={running ? 'Hãy dừng hồ sơ trước khi xoá' : undefined}
            onClick={onDelete}
          >
            <IconTrash size={14} />
            Xoá hồ sơ
          </button>
        )}
        <span className="spacer" />
        <button className="btn" disabled={saving} onClick={onCancel}>
          Huỷ
        </button>
        <button className="btn primary" disabled={!valid} onClick={submit}>
          {saving ? 'Đang lưu…' : profile ? 'Lưu thay đổi' : 'Tạo hồ sơ'}
        </button>
      </div>
    </>
  )
}
