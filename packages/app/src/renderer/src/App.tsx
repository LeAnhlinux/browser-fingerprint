import type { CoreInfo } from '@bf/core';
import { useCallback, useEffect, useState } from 'react';
import { EngineGate } from './EngineGate';
import { api } from './api';

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<CoreInfo | null>(null);
  const reload = useCallback(async () => setInfo(await api.info()), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!info) return <div className="app muted">Đang tải…</div>;
  if (!info.engineInstalled) return <EngineGate info={info} onInstalled={() => void reload()} />;
  return <div className="app">Nhân {info.engineVersion} đã sẵn sàng.</div>;
}
