import type { Extension, Group, Platform, ProfileInput, ProfileView, ProxyView } from '@bf/core'
import {
  IconCopyPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconSearch,
  IconUsers
} from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { BulkBar } from '../BulkBar'
import { BulkCreateForm } from '../BulkCreateForm'
import { ProfileDrawer, type DrawerTab } from '../ProfileDrawer'
import { api } from '../api'
import { Banner, RunStatus } from '../ui'

interface Props {
  profiles: ProfileView[]
  groups: Group[]
  proxies: ProxyView[]
  extensions: Extension[]
  groupExtensions: Record<string, string[]>
  hostPlatform: Platform
  search: string
  onSearch: (value: string) => void
  groupFilter: string
  onGroupFilter: (value: string) => void
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  error: string
  clearError: () => void
}

type Open = { kind: 'new' } | { kind: 'edit'; id: string; tab: DrawerTab } | null

const PLATFORM_SHORT: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux'
}

export function ProfilesPage(props: Props): React.JSX.Element {
  const { profiles, groups, proxies, run, error, clearError } = props
  const [open, setOpen] = useState<Open>(null)
  const [showBulkCreate, setShowBulkCreate] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const openProfile =
    open?.kind === 'edit' ? (profiles.find((p) => p.id === open.id) ?? null) : null
  // Hồ sơ đang mở bị xoá (hoặc bị lọc mất) thì đóng ngăn kéo.
  if (open?.kind === 'edit' && !openProfile) setOpen(null)

  const selectedIds = profiles.filter((p) => selected.has(p.id)).map((p) => p.id)
  const allSelected = profiles.length > 0 && selectedIds.length === profiles.length
  const filtered = props.search.trim() !== '' || props.groupFilter !== 'all'

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const startStop = async (p: ProfileView): Promise<void> => {
    if (pending.has(p.id)) return
    setPending((prev) => new Set(prev).add(p.id))
    await run(() => (p.run ? api.stop(p.id) : api.launch(p.id)))
    setPending((prev) => {
      const next = new Set(prev)
      next.delete(p.id)
      return next
    })
  }

  const save = async (input: ProfileInput): Promise<void> => {
    if (savingRef.current) return
    savingRef.current = true
    const target = open
    setSaving(true)
    try {
      const ok = await run(() =>
        target?.kind === 'edit' ? api.updateProfile(target.id, input) : api.createProfile(input)
      )
      if (ok) setOpen(null)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const remove = (p: ProfileView): void => {
    if (
      window.confirm(
        `Xoá hồ sơ "${p.name}" cùng toàn bộ dữ liệu trình duyệt của nó (cookie, phiên đăng nhập, dữ liệu extension)? Không khôi phục được.`
      )
    ) {
      void run(() => api.deleteProfile(p.id)).then((ok) => {
        if (ok) setOpen(null)
      })
    }
  }

  const proxyCell = (p: ProfileView): React.JSX.Element => {
    if (!p.proxyId) return <span className="faint">Không dùng</span>
    const x = proxies.find((y) => y.id === p.proxyId)
    if (!x) return <span className="faint">—</span>
    const state = x.lastStatus === 'ok' ? 'ok' : x.lastStatus === 'fail' ? 'fail' : 'idle'
    return (
      <span className={`pill${state === 'fail' ? ' fail' : ''}`} title={x.lastError ?? undefined}>
        <span className={`dot ${state}`} style={{ boxShadow: 'none' }} />
        {x.lastStatus === 'ok' && x.lastCountry ? `${x.lastCountry} · ` : ''}
        {x.host}:{x.port}
      </span>
    )
  }

  const groupName = (id: string | null): string | null =>
    groups.find((g) => g.id === id)?.name ?? null

  return (
    <div className="page">
      <div className="page-head">
        <h1>Hồ sơ</h1>
        <button
          className="btn"
          onClick={() => {
            clearError()
            setShowBulkCreate(true)
          }}
        >
          <IconCopyPlus size={15} />
          Tạo hàng loạt
        </button>
        <button
          className="btn primary"
          onClick={() => {
            clearError()
            setOpen({ kind: 'new' })
          }}
        >
          <IconPlus size={15} />
          Hồ sơ mới
        </button>
      </div>

      {error && !open && !showBulkCreate && (
        <Banner kind="error" onClose={clearError}>
          {error}
        </Banner>
      )}

      <div className="toolbar">
        <div className="search">
          <IconSearch size={15} />
          <input
            value={props.search}
            onChange={(e) => props.onSearch(e.target.value)}
            placeholder="Tìm theo tên hồ sơ"
            aria-label="Tìm theo tên hồ sơ"
          />
        </div>
        <select
          value={props.groupFilter}
          onChange={(e) => props.onGroupFilter(e.target.value)}
          aria-label="Lọc theo nhóm"
        >
          <option value="all">Tất cả nhóm</option>
          <option value="none">Chưa gán nhóm</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        {profiles.length === 0 ? (
          filtered ? (
            <div className="empty">
              <h2>Không có hồ sơ nào khớp</h2>
              <p>Thử từ khoá khác hoặc chọn “Tất cả nhóm”.</p>
            </div>
          ) : (
            <div className="empty">
              <IconUsers size={36} stroke={1.5} />
              <h2>Tạo hồ sơ đầu tiên</h2>
              <p>Mỗi hồ sơ là một trình duyệt riêng: dấu vân tay, proxy và cookie tách biệt.</p>
              <button className="btn primary" onClick={() => setOpen({ kind: 'new' })}>
                <IconPlus size={15} />
                Hồ sơ mới
              </button>
            </div>
          )
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(profiles.map((p) => p.id)) : new Set())
                    }
                  />
                </th>
                <th>Tên</th>
                <th>Nhóm</th>
                <th>Proxy</th>
                <th>Trạng thái</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const group = groupName(p.groupId)
                return (
                  <tr
                    key={p.id}
                    className={`clickable${selected.has(p.id) ? ' selected' : ''}`}
                    onClick={() => {
                      clearError()
                      setOpen({ kind: 'edit', id: p.id, tab: 'settings' })
                    }}
                  >
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${p.name}`}
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                    </td>
                    <td>
                      <div className="cell-title">{p.name}</div>
                      <div className="cell-sub">
                        {PLATFORM_SHORT[p.platform]} · {p.timezone}
                        {p.notes ? ` · ${p.notes.split('\n')[0].slice(0, 40)}` : ''}
                      </div>
                    </td>
                    <td>
                      {group ? (
                        <span className="badge">{group}</span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td>{proxyCell(p)}</td>
                    <td>
                      <RunStatus profile={p} />
                    </td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`icon-btn ${p.run ? 'stop' : 'run'}`}
                        aria-label={p.run ? `Dừng ${p.name}` : `Khởi động ${p.name}`}
                        title={p.run ? 'Dừng' : 'Khởi động'}
                        disabled={pending.has(p.id)}
                        onClick={() => void startStop(p)}
                      >
                        {p.run ? <IconPlayerStop size={17} /> : <IconPlayerPlay size={17} />}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedIds.length > 0 && !open && (
        <BulkBar
          ids={selectedIds}
          proxiedCount={profiles.filter((p) => selected.has(p.id) && p.proxyId !== null).length}
          groups={groups}
          proxies={proxies}
          run={run}
          onClear={() => setSelected(new Set())}
        />
      )}

      {open && (
        <ProfileDrawer
          profile={openProfile}
          tab={open.kind === 'edit' ? open.tab : 'settings'}
          onTab={(tab) => open.kind === 'edit' && setOpen({ ...open, tab })}
          groups={groups}
          proxies={proxies}
          extensions={props.extensions}
          groupExtensions={props.groupExtensions}
          hostPlatform={props.hostPlatform}
          error={error}
          saving={saving}
          pending={openProfile ? pending.has(openProfile.id) : false}
          onSave={(input) => void save(input)}
          onDelete={() => openProfile && remove(openProfile)}
          onStart={() => openProfile && void startStop(openProfile)}
          onStop={() => openProfile && void startStop(openProfile)}
          onClose={() => {
            clearError()
            setOpen(null)
          }}
        />
      )}

      {showBulkCreate && (
        <BulkCreateForm
          groups={groups}
          error={error}
          run={run}
          onClose={() => {
            clearError()
            setShowBulkCreate(false)
          }}
        />
      )}
    </div>
  )
}
