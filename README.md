# HYPERSPACE

A Matrix-styled, sacred-geometry "control deck" for Windows. One app for the things you usually open five tools for:

- **Privacy switches**: seal the microphone and camera, and see which apps used them.
- **Operations**: what's running and what it costs (CPU, memory, graphics), with end / restart / suspend / eco mode.
- **Fans & temperatures**: live readouts, overheat alarm, power modes. On Acer Nitro / Predator laptops also one-click
  cooling presets, fan curves and the NitroSense key.
- **VJ**: visuals that react to whatever is playing, on screen, as a live wallpaper, or sent to Resolume / OBS /
  TouchDesigner over Spout.
- **Crate & deck**: your music library (rekordbox or plain folders), volume, now playing, speakers and screens.
- **Notes**: an encrypted notebook and journal. Everyday notes open by themselves; the journal needs your password.
  Copies can go to a backup drive. Imports OneNote exports.
- **To-do** with a "De-Big-Tech my life" quest line, **games** (blackjack, poker, spades), a **file router** that sorts
  downloads, a **side dock**, **FIND** (Ctrl+F), your choice of accent colour (Settings → LOOK), and a **phone remote** over your Wi-Fi.

## Download

Grab the latest release from the **Releases** page:

| File | For |
| --- | --- |
| `HYPERSPACE-Setup-<version>-x64.exe` | Almost every Windows PC (Intel or AMD) |
| `HYPERSPACE-Setup-<version>-arm64.exe` | Windows on ARM (Snapdragon laptops) |
| `HYPERSPACE-<version>-<arch>-portable.zip` | No installer: unzip anywhere and run `HYPERSPACE.exe` |

The app isn't code-signed yet, so Windows SmartScreen says "Windows protected your PC". Click **More info → Run anyway**.

### Updating

After the first install, new versions are one click: **Settings → General → UPDATES** shows "Version X is ready" and an
**UPDATE** button. It downloads and restarts into the new version. Your notes and settings are not touched.

### Requirements

- Windows 10 22H2 or Windows 11, 64-bit (x64 or ARM64)
- 4 GB RAM (8 GB recommended), about 1 GB free disk space
- Graphics with DirectX 11 / WebGL for the visuals (there's a no-GPU safe mode)
- Admin rights are **optional**: everything works without them except fan control, power limits, the camera hard
  switch and the one-click VPN. HYPERSPACE asks Windows only when you use one of those.

Hardware-specific extras switch on by themselves when the hardware is there: Acer fan control and the NitroSense key
on Acer Nitro / Predator laptops, graphics-card clocks and temperature on NVIDIA cards.

## Build it yourself

You need [Node.js](https://nodejs.org) 20 or newer and the [.NET 8 SDK](https://dotnet.microsoft.com/download).

```bash
npm install
npm start            # run from source
npm run core         # build the C# helper (HyperCore) for x64
npm run dist         # installers + portable zips for x64 and ARM64, into installer/
```

## How it's put together

- `src/`: the Electron main process (`main.js`), the encrypted notes vault (`notes.js`), the phone link (`remote.js`).
- `renderer/`: every page (plain HTML, CSS and JavaScript, no framework).
- `core/`: **HyperCore**, a C# helper for hardware and system access. It talks to the app over a local connection
  that needs a fresh one-time token, and it only runs with admin rights when you allow it.

### Security notes

- Notes are encrypted with AES-256-GCM. The journal key is protected by your password (scrypt) and a recovery key.
- The phone link only works on Wi-Fi networks you've marked as trusted, needs the pairing key, and can only use a
  short list of controls (media, volume, fan presets, the mic and camera switches, status). It can't run programs, read notes or touch files.
- App windows can't be steered to outside pages, and the installed app refuses debugger switches.

## License

MIT. See [LICENSE](LICENSE).
