import type { Group, ProfileView, ProxyView } from '@bf/core'

interface Props {
  profiles: ProfileView[]
  groups: Group[]
  proxies: ProxyView[]
  onStart: (id: string) => void
  onStop: (id: string) => void
  onEdit: (p: ProfileView) => void
  onCookies: (p: ProfileView) => void
  onDelete: (p: ProfileView) => void
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: (ids: string[], checked: boolean) => void
}

export function ProfileList({
  profiles,
  groups,
  proxies,
  onStart,
  onStop,
  onEdit,
  onCookies,
  onDelete,
  selected,
  onToggle,
  onToggleAll
}: Props): React.JSX.Element {
  const groupName = (id: string | null): string => groups.find((g) => g.id === id)?.name ?? '—'
  const proxyLabel = (id: string | null): string => {
    const x = proxies.find((p) => p.id === id)
    return x ? `${x.protocol}://${x.host}:${x.port}` : 'Không dùng'
  }

  if (profiles.length === 0)
    return <p className="muted">Chưa có hồ sơ nào khớp. Bấm &quot;Hồ sơ mới&quot; để tạo.</p>

  const allIds = profiles.map((p) => p.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))

  return (
    <table>
      <thead>
        <tr>
          <th className="check">
            <input
              type="checkbox"
              aria-label="Chọn tất cả"
              checked={allSelected}
              onChange={(e) => onToggleAll(allIds, e.target.checked)}
            />
          </th>
          <th>Tên</th>
          <th>Nhóm</th>
          <th>Proxy</th>
          <th>Trạng thái</th>
          <th>Cổng CDP</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => (
          <tr key={p.id}>
            <td className="check">
              <input
                type="checkbox"
                aria-label={`Chọn ${p.name}`}
                checked={selected.has(p.id)}
                onChange={() => onToggle(p.id)}
              />
            </td>
            <td>{p.name}</td>
            <td>{groupName(p.groupId)}</td>
            <td>{proxyLabel(p.proxyId)}</td>
            <td className={p.run ? 'status-running' : 'muted'}>
              {p.run ? (p.run.headless ? 'Đang chạy ẩn' : 'Đang chạy') : 'Sẵn sàng'}
            </td>
            <td>{p.run ? p.run.cdpPort : '—'}</td>
            <td className="actions">
              {p.run ? (
                <button onClick={() => onStop(p.id)}>Dừng</button>
              ) : (
                <button className="primary" onClick={() => onStart(p.id)}>
                  Khởi động
                </button>
              )}
              <button onClick={() => onCookies(p)}>Cookie</button>
              <button onClick={() => onEdit(p)}>Sửa</button>
              <button className="danger" disabled={p.run !== null} onClick={() => onDelete(p)}>
                Xoá
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
