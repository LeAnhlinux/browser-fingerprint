import type { Group, LocaleApplyResult, ProxyView } from '@bf/core'
import { useState } from 'react'
import { api } from './api'

interface Props {
  ids: string[]
  groups: Group[]
  proxies: ProxyView[]
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onClear: () => void
}

export function BulkBar({ ids, groups, proxies, run, onClear }: Props): React.JSX.Element {
  const [groupId, setGroupId] = useState('')
  const [proxyId, setProxyId] = useState('')
  const [note, setNote] = useState('')

  const act = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    setNote('')
    if (await run(fn)) setNote(done)
  }

  const applyLocale = async (): Promise<void> => {
    setNote('')
    const box: { value: LocaleApplyResult | null } = { value: null }
    const ok = await run(async () => {
      box.value = await api.applyProxyLocale(ids)
    })
    if (!ok || !box.value) return
    const r = box.value
    const skipped = r.skipped.map((s) => `${s.name}: ${s.reason}`).join('; ')
    setNote(`Đã cập nhật ${r.updated} hồ sơ` + (skipped ? `. Bỏ qua: ${skipped}` : ''))
  }

  const setProxy = (): void => {
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

  return (
    <div className="bulk-bar">
      <strong>Đã chọn {ids.length}</strong>
      <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
        <option value="">Chưa gán</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button
        onClick={() =>
          void act(() => api.updateProfilesBulk(ids, { groupId: groupId || null }), 'Đã đổi nhóm')
        }
      >
        Gán nhóm
      </button>
      <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
        <option value="">Không dùng</option>
        {proxies.map((x) => (
          <option key={x.id} value={x.id}>{`${x.protocol}://${x.host}:${x.port}`}</option>
        ))}
      </select>
      <button onClick={setProxy}>Gán proxy</button>
      <button
        onClick={() =>
          void act(() => api.assignUnusedProxies(ids), 'Đã gán proxy chưa dùng lần lượt')
        }
      >
        Gán proxy chưa dùng lần lượt
      </button>
      <button onClick={() => void applyLocale()}>Múi giờ, ngôn ngữ theo proxy</button>
      <span className="grow muted">{note}</span>
      <button onClick={onClear}>Bỏ chọn</button>
    </div>
  )
}
