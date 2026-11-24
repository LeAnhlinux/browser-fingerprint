import { contextBridge, ipcRenderer } from 'electron'

const bf = {
  call: (method: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke('bf:call', method, args),
  installEngine: (): Promise<void> => ipcRenderer.invoke('bf:installEngine'),
  addExtension: (kind: 'folder' | 'file'): Promise<unknown> =>
    ipcRenderer.invoke('bf:addExtension', kind),
  updateExtension: (id: string, kind: 'folder' | 'file'): Promise<unknown> =>
    ipcRenderer.invoke('bf:updateExtension', id, kind),
  exportCookies: (profileId: string): Promise<unknown> =>
    ipcRenderer.invoke('bf:exportCookies', profileId),
  apiStatus: (): Promise<unknown> => ipcRenderer.invoke('bf:apiStatus'),
  revealApiToken: (): Promise<unknown> => ipcRenderer.invoke('bf:revealApiToken'),
  onChange: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('bf:change', listener)
    return () => ipcRenderer.removeListener('bf:change', listener)
  },
  onEngineProgress: (cb: (received: number, total: number) => void): (() => void) => {
    const listener = (_e: unknown, received: number, total: number): void => cb(received, total)
    ipcRenderer.on('bf:engineProgress', listener)
    return () => ipcRenderer.removeListener('bf:engineProgress', listener)
  }
}

contextBridge.exposeInMainWorld('bf', bf)

export type BfBridge = typeof bf
