import { app, shell, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions, SaveDialogOptions } from 'electron'
import { chmod, writeFile } from 'fs/promises'
import { pathToFileURL } from 'url'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Core, type SecretBox } from '@bf/core'
import { DEFAULT_PORT, loadOrCreateToken, startApiServer, tokenPath, type ApiServer } from '@bf/api'

const METHODS = new Set([
  'info',
  'listProfiles',
  'createProfile',
  'updateProfile',
  'deleteProfile',
  'measureFingerprint',
  'regenerateFingerprint',
  'listGroups',
  'createGroup',
  'renameGroup',
  'deleteGroup',
  'listProxies',
  'createProxy',
  'updateProxy',
  'deleteProxy',
  'importProxies',
  'checkProxy',
  'checkProxies',
  'createProfilesBulk',
  'updateProfilesBulk',
  'assignUnusedProxies',
  'applyProxyLocale',
  'importCookies',
  'listExtensions',
  'deleteExtension',
  'setProfileExtensions',
  'setGroupExtensions',
  'listGroupExtensions',
  'launch',
  'stop'
])

const secrets: SecretBox = {
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64'))
}

app.setName('Browser Fingerprint')

const APP_ID = 'local.browserfingerprint.app'

let core: Core | undefined
let quitting = false

interface ApiStatus {
  enabled: boolean
  running: boolean
  port: number
  error: string | null
}

let apiServer: ApiServer | undefined
let apiStatus: ApiStatus = { enabled: false, running: false, port: DEFAULT_PORT, error: null }

function isOwnUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return url.origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    }
    return (
      url.protocol === 'file:' &&
      url.pathname === pathToFileURL(join(__dirname, '../renderer/index.html')).pathname
    )
  } catch {
    return false
  }
}

function assertOwnSender(event: IpcMainInvokeEvent): void {
  if (
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !isOwnUrl(event.senderFrame.url)
  ) {
    throw new Error('Nguồn gọi không hợp lệ')
  }
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

// API cục bộ là phần thêm: hỏng thì app vẫn chạy và giao diện báo lý do.
async function startApi(c: Core): Promise<void> {
  if (process.env.BF_API === '0') return
  const raw = process.env.BF_API_PORT
  const port = raw ? Number(raw) : DEFAULT_PORT
  apiStatus = { enabled: true, running: false, port, error: null }
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('BF_API_PORT không hợp lệ')
    const token = loadOrCreateToken(tokenPath(app.getPath('userData')))
    apiServer = await startApiServer({
      core: c,
      token,
      port,
      onError: (info) => console.error('[api] 500', info)
    })
    apiStatus = { ...apiStatus, running: true, port: apiServer.port }
  } catch (e) {
    apiStatus = { ...apiStatus, error: e instanceof Error ? e.message : 'Không khởi động được API' }
  }
}

async function startCore(): Promise<void> {
  const c = new Core({
    dataDir: app.getPath('userData'),
    secrets,
    ...(process.env.BF_ENGINES_DIR ? { enginesDir: process.env.BF_ENGINES_DIR } : {}),
    ...(process.env.BF_IP_LOOKUP_URL ? { lookupUrl: process.env.BF_IP_LOOKUP_URL } : {})
  })
  await c.init()
  core = c
  c.on('change', () => broadcast('bf:change'))
  ipcMain.handle('bf:call', async (event, method: string, args: unknown[]) => {
    assertOwnSender(event)
    if (typeof method !== 'string' || !Array.isArray(args)) throw new Error('Tham số không hợp lệ')
    if (!METHODS.has(method)) throw new Error(`Phương thức không hợp lệ: ${method}`)
    const fn = (c as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
    return fn.apply(c, args)
  })
  ipcMain.handle('bf:installEngine', async (event) => {
    assertOwnSender(event)
    await c.installEngine((received, total) => broadcast('bf:engineProgress', received, total))
    broadcast('bf:change')
  })

  // Đường dẫn file luôn đến từ hộp thoại của hệ điều hành, không bao giờ từ renderer.
  ipcMain.handle('bf:addExtension', async (event, kind: unknown) => {
    assertOwnSender(event)
    if (kind !== 'folder' && kind !== 'file') throw new Error('Tham số không hợp lệ')
    const options: OpenDialogOptions =
      kind === 'folder'
        ? { title: 'Chọn thư mục extension đã giải nén', properties: ['openDirectory'] }
        : {
            title: 'Chọn file extension',
            properties: ['openFile'],
            filters: [{ name: 'Extension', extensions: ['crx', 'zip'] }]
          }
    const win = BrowserWindow.fromWebContents(event.sender)
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return null
    return c.addExtension(picked.filePaths[0])
  })

  // Cookie đi thẳng từ lõi ra file người dùng chọn, không qua renderer.
  ipcMain.handle('bf:exportCookies', async (event, profileId: unknown) => {
    assertOwnSender(event)
    const profile = typeof profileId === 'string' ? c.store.getProfile(profileId) : null
    if (!profile) throw new Error('Không tìm thấy hồ sơ')
    const safeName = profile.name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 50) || 'ho-so'
    const options: SaveDialogOptions = {
      title: 'Lưu cookie',
      defaultPath: `cookies-${safeName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const picked = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { saved: false, count: 0 }
    const { count, json } = await c.exportCookies(profile.id)
    await writeFile(picked.filePath, json, { mode: 0o600 })
    // mode chỉ có tác dụng khi file mới được tạo; ghi đè file cũ thì siết quyền lại ở đây.
    await chmod(picked.filePath, 0o600).catch(() => {})
    return { saved: true, count }
  })

  ipcMain.handle('bf:apiStatus', (event) => {
    assertOwnSender(event)
    return apiStatus
  })
  ipcMain.handle('bf:revealApiToken', (event) => {
    assertOwnSender(event)
    shell.showItemInFolder(tokenPath(app.getPath('userData')))
    return true
  })

  await startApi(c)
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const { protocol } = new URL(details.url)
      if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(details.url)
    } catch {
      // URL không hợp lệ: bỏ qua
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isOwnUrl(url)) event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId(APP_ID)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    await startCore()
  } catch (e) {
    dialog.showErrorBox(
      'Không thể khởi động',
      `Không khởi động được lõi ứng dụng: ${e instanceof Error ? e.message : String(e)}`
    )
    app.quit()
    return
  }

  // Khi chạy dev, Dock hiện icon Electron mặc định; bản đóng gói lấy icon từ build/icon.icns.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon)

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (quitting || !core) return
  event.preventDefault()
  quitting = true
  const c = core
  void (apiServer ? apiServer.close() : Promise.resolve())
    .catch(() => undefined)
    .then(() => c.shutdown())
    .catch(() => undefined)
    .finally(() => app.quit())
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
