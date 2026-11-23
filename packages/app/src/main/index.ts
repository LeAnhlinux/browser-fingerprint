import { app, shell, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { pathToFileURL } from 'url'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Core, type SecretBox } from '@bf/core'

const METHODS = new Set([
  'info', 'listProfiles', 'createProfile', 'updateProfile', 'deleteProfile',
  'listGroups', 'createGroup', 'renameGroup', 'deleteGroup',
  'listProxies', 'createProxy', 'updateProxy', 'deleteProxy',
  'launch', 'stop',
])

const secrets: SecretBox = {
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
}

app.setName('Browser Fingerprint')

const APP_ID = 'local.browserfingerprint.app'

let core: Core | undefined
let quitting = false

function isOwnUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return url.origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    }
    return url.protocol === 'file:' && url.pathname === pathToFileURL(join(__dirname, '../renderer/index.html')).pathname
  } catch {
    return false
  }
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

async function startCore(): Promise<void> {
  const c = new Core({
    dataDir: app.getPath('userData'),
    secrets,
    ...(process.env.BF_ENGINES_DIR ? { enginesDir: process.env.BF_ENGINES_DIR } : {})
  })
  await c.init()
  core = c
  c.on('change', () => broadcast('bf:change'))
  ipcMain.handle('bf:call', async (event, method: string, args: unknown[]) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isOwnUrl(event.senderFrame.url)) {
      throw new Error('Nguồn gọi không hợp lệ')
    }
    if (typeof method !== 'string' || !Array.isArray(args)) throw new Error('Tham số không hợp lệ')
    if (!METHODS.has(method)) throw new Error(`Phương thức không hợp lệ: ${method}`)
    const fn = (c as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
    return fn.apply(c, args)
  })
  ipcMain.handle('bf:installEngine', async (event) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isOwnUrl(event.senderFrame.url)) {
      throw new Error('Nguồn gọi không hợp lệ')
    }
    await c.installEngine((received, total) => broadcast('bf:engineProgress', received, total))
    broadcast('bf:change')
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
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
    dialog.showErrorBox('Không thể khởi động', `Không khởi động được lõi ứng dụng: ${e instanceof Error ? e.message : String(e)}`)
    app.quit()
    return
  }

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
  void core.shutdown().catch(() => undefined).finally(() => app.quit())
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
