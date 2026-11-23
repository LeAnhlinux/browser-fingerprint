import type { Group, LocaleApplyResult, ProxyView } from '@bf/core'
import { useRef, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import { api } from './api'
import { proxyOption } from './format'

interface Props {
  ids: string[]
  proxiedCount: number
  groups: Group[]
  proxies: ProxyView[]
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onClear: () => void
}

export function BulkBar({
  ids,
  proxiedCount,
  groups,
  proxies,
  run,
  onClear
}: Props): React.JSX.Element {
  const [groupId, setGroupId] = useState('')
  const [proxyId, setProxyId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  // Đổi vùng chọn thì xoá thông báo kết quả cũ; chọn nhóm hoặc proxy đã bị xoá thì về "".
  const idsKey = ids.join(',')
  const [seenKey, setSeenKey] = useState(idsKey)
  if (seenKey !== idsKey) {
    setSeenKey(idsKey)
    setNote('')
  }
  if (groupId !== '' && !groups.some((g) => g.id === groupId)) setGroupId('')
  if (proxyId !== '' && !proxies.some((x) => x.id === proxyId)) setProxyId('')

  // Chặn đồng bộ: mọi nút của thanh này dùng chung một cờ, lần bấm thứ hai trong lúc đang chạy bị bỏ qua.
  const exclusive = async (fn: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await fn()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const act = (fn: () => Promise<unknown>, done: string): Promise<void> =>
    exclusive(async () => {
      setNote('')
      if (await run(fn)) setNote(done)
    })

  const applyLocale = (): Promise<void> =>
    exclusive(async () => {
      setNote('')
      const box: { value: LocaleApplyResult | null } = { value: null }
      const ok = await run(async () => {
        box.value = await api.applyProxyLocale(ids)
      })
      if (!ok || !box.value) return
      const r = box.value
      const skipped = r.skipped.map((s) => `${s.name}: ${s.reason}`).join('; ')
      setNote(`Đã cập nhật ${r.updated} hồ sơ` + (skipped ? `. Bỏ qua: ${skipped}` : ''))
    })

  const setProxy = (): void => {
    if (busyRef.current) return
    if (
      proxyId === '' &&
      !window.confirm(
        `Gỡ proxy khỏi ${ids.length} hồ sơ đã chọn? Các hồ sơ này sẽ kết nối trực tiếp bằng IP thật.`
      )
    ) {
      return
    }
    void act(() => api.updateProfilesBulk(ids, { proxyId: proxyId || null }), 'Đã đổi proxy')
  }

  const assignUnused = (): void => {
    if (busyRef.current) return
    if (
      proxiedCount > 0 &&
      !window.confirm(`${proxiedCount} hồ sơ đã có proxy sẽ bị đổi sang proxy khác. Tiếp tục?`)
    ) {
      return
    }
    void act(() => api.assignUnusedProxies(ids), 'Đã gán proxy chưa dùng lần lượt')
  }

  return (
    <div className="bulk-bar" role="region" aria-label="Thao tác với hồ sơ đã chọn">
      <button className="icon-btn" title="Bỏ chọn" aria-label="Bỏ chọn" onClick={onClear}>
        <IconX size={16} />
      </button>
      <span className="count">Đã chọn {ids.length}</span>
      <span className="sep" />
      <select
        disabled={busy}
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
        aria-label="Nhóm để gán"
      >
        <option value="">Chưa gán nhóm</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button
        className="btn sm"
        disabled={busy}
        onClick={() =>
          void act(() => api.updateProfilesBulk(ids, { groupId: groupId || null }), 'Đã đổi nhóm')
        }
      >
        Gán nhóm
      </button>
      <span className="sep" />
      <select
        disabled={busy}
        value={proxyId}
        onChange={(e) => setProxyId(e.target.value)}
        aria-label="Proxy để gán"
      >
        <option value="">Không dùng proxy</option>
        {proxies.map((x) => (
          <option key={x.id} value={x.id}>
            {proxyOption(x)}
          </option>
        ))}
      </select>
      <button className="btn sm" disabled={busy} onClick={setProxy}>
        Gán proxy
      </button>
      <button className="btn sm" disabled={busy} onClick={assignUnused}>
        Gán proxy chưa dùng
      </button>
      <button className="btn sm" disabled={busy} onClick={() => void applyLocale()}>
        Múi giờ theo proxy
      </button>
      {note && <span className="note">{note}</span>}
    </div>
  )
}
