import type { Group, ProxyProtocol, ProxyView } from '@bf/core';
import { useState } from 'react';
import { api } from './api';

interface Props {
  groups: Group[];
  proxies: ProxyView[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}

export function SettingsPanel({ groups, proxies, run, onClose }: Props): React.JSX.Element {
  const [groupName, setGroupName] = useState('');
  const [protocol, setProtocol] = useState<ProxyProtocol>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const addGroup = (): void => {
    const name = groupName.trim();
    if (!name) return;
    void run(() => api.createGroup(name)).then(() => setGroupName(''));
  };

  const renameGroup = (g: Group): void => {
    const name = window.prompt('Tên nhóm mới', g.name)?.trim();
    if (name) void run(() => api.renameGroup(g.id, name));
  };

  const proxyValid = host.trim() !== '' && Number(port) > 0 && Number(port) < 65536;
  const addProxy = (): void => {
    if (!proxyValid) return;
    void run(() =>
      api.createProxy({ protocol, host: host.trim(), port: Number(port), username: username.trim() || null, password: password || null }),
    ).then(() => {
      setHost('');
      setPort('');
      setUsername('');
      setPassword('');
    });
  };

  return (
    <div className="overlay">
      <div className="dialog">
        <h2>Nhóm</h2>
        {groups.length === 0 && <p className="muted">Chưa có nhóm.</p>}
        {groups.map((g) => (
          <div className="list-item" key={g.id}>
            <span className="grow">{g.name}</span>
            <button onClick={() => renameGroup(g)}>Đổi tên</button>
            <button className="danger" onClick={() => void run(() => api.deleteGroup(g.id))}>Xoá</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Tên nhóm" />
          <button disabled={!groupName.trim()} onClick={addGroup}>Thêm nhóm</button>
        </div>

        <h2 style={{ marginTop: 22 }}>Proxy</h2>
        {proxies.length === 0 && <p className="muted">Chưa có proxy.</p>}
        {proxies.map((x) => (
          <div className="list-item" key={x.id}>
            <span className="grow">
              {`${x.protocol}://${x.host}:${x.port}`}
              {x.username && <span className="muted"> · {x.username}{x.hasPassword ? ' · có mật khẩu' : ''}</span>}
            </span>
            <button className="danger" onClick={() => void run(() => api.deleteProxy(x.id))}>Xoá</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <select value={protocol} onChange={(e) => setProtocol(e.target.value as ProxyProtocol)}>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Địa chỉ" />
          <input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="Cổng" />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tài khoản (nếu có)" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu (nếu có)" />
          <button disabled={!proxyValid} onClick={addProxy}>Thêm proxy</button>
        </div>

        <div className="dialog-actions">
          <button onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
