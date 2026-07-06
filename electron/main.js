// Desktop mode: boots the same Express server on a free local port,
// stores data in Electron's userData dir, and opens a window auto-logged-in as admin.
//
// Note: in desktop mode tracking pixels / unsubscribe links only resolve while the
// app is running and reachable — desktop mode is for authoring + small sends.
// Deploy to a VPS (BASE_URL set) for real campaigns.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');

let win;

app.whenReady().then(async () => {
  const dataDir = path.join(app.getPath('userData'), 'data');
  const autologinToken = crypto.randomBytes(24).toString('hex');

  const { createApp } = require(path.join(__dirname, '..', 'server', 'app.js'));
  const server = createApp({ dataDir, autologinToken, adminPassword: process.env.ADMIN_PASSWORD || 'admin' });

  // listen on port 0 → OS picks a free port (no collisions with a VPS install)
  const listener = server.listen(0, '127.0.0.1', () => {
    const port = listener.address().port;
    server.locals.setBaseUrl(`http://127.0.0.1:${port}`);
    win = new BrowserWindow({
      width: 1360,
      height: 880,
      autoHideMenuBar: true,
      backgroundColor: '#09090b',
      title: 'Postbird',
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    // open external links in the system browser
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    win.loadURL(`http://127.0.0.1:${port}/auth/auto?token=${autologinToken}`);
  });

  app.on('window-all-closed', () => {
    listener.close();
    app.quit();
  });
});
