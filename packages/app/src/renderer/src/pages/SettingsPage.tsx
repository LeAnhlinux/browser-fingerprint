import type { CoreInfo } from '@bf/core'
import { IconFolderOpen } from '@tabler/icons-react'
import { api, type ApiStatus } from '../api'
import { CapMonsterCard } from '../CapMonsterCard'
import { Banner } from '../ui'

interface Props {
  info: CoreInfo
  apiInfo: ApiStatus | null
}

const PLATFORM: Record<CoreInfo['hostPlatform'], string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux'
}

export function SettingsPage({ info, apiInfo }: Props): React.JSX.Element {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Cài đặt</h1>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <h2>Nhân trình duyệt</h2>
          <span className="pill ok">
            <span className="dot ok" />
            Đã cài
          </span>
        </div>
        <dl className="kv">
          <dt>Phiên bản</dt>
          <dd className="mono">fingerprint-chromium {info.engineVersion}</dd>
          <dt>Máy này</dt>
          <dd>{PLATFORM[info.hostPlatform]}</dd>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-head">
          <h2>API cục bộ, lệnh bf và MCP</h2>
          {apiInfo?.running ? (
            <span className="pill ok">
              <span className="dot ok" />
              Đang chạy
            </span>
          ) : apiInfo?.enabled ? (
            <span className="pill fail">
              <span className="dot fail" />
              Không chạy
            </span>
          ) : (
            <span className="pill">
              <span className="dot idle" />
              Đã tắt
            </span>
          )}
        </div>
        {apiInfo?.enabled && !apiInfo.running && (
          <Banner kind="error">{apiInfo.error ?? 'Không rõ lý do'}</Banner>
        )}
        {apiInfo && !apiInfo.enabled && (
          <Banner kind="info">API bị tắt vì app được mở với biến môi trường BF_API=0.</Banner>
        )}
        {apiInfo?.running && (
          <>
            <dl className="kv" style={{ marginBottom: 14 }}>
              <dt>Địa chỉ</dt>
              <dd className="mono">http://127.0.0.1:{apiInfo.port}</dd>
              <dt>Xác thực</dt>
              <dd>Mọi request cần header Authorization: Bearer &lt;token&gt;</dd>
            </dl>
            <button className="btn" onClick={() => void api.revealApiToken()}>
              <IconFolderOpen size={15} />
              Hiện file token
            </button>
            <p className="faint" style={{ marginTop: 12 }}>
              File token tương đương mật khẩu: ai đọc được nó là điều khiển được mọi hồ sơ và lấy
              được cookie. Xoá file rồi mở lại app để đổi token. Cách dùng lệnh bf và MCP xem trong
              hướng dẫn sử dụng.
            </p>
          </>
        )}
      </div>

      <CapMonsterCard />
    </div>
  )
}
