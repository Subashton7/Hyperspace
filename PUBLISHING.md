# Putting HYPERSPACE on GitHub

1. **Make a clean copy** (no personal files, no Git history with your email in it):

   ```bash
   node scripts/export-public.js
   ```

   That fills `C:\dev\hyperspace-github`.

2. **Create an empty repository** on github.com (no README, no license: those are already in the copy).

3. **Push the copy** from inside `C:\dev\hyperspace-github`. Use GitHub's private "noreply" email for commits
   (GitHub → Settings → Emails → "Keep my email addresses private" shows it):

   ```bash
   git init
   git config user.email "<your-id>+<username>@users.noreply.github.com"
   git add .
   git commit -m "HYPERSPACE 0.11.0"
   git branch -M main
   git remote add origin https://github.com/<you>/hyperspace.git
   git push -u origin main
   ```

4. **Releases build themselves.** `.github/workflows/build.yml` builds the x64 and ARM64 installers and portable zips
   on GitHub's machines. To publish a version, tag it and push the tag:

   ```bash
   git tag v0.11.0
   git push origin v0.11.0
   ```

   The files appear under **Releases** a few minutes later.

## Before you publish, think about

- **SUBASHTON branding** (the VJ logo theme, the about card) ships as part of the app. Keep it as your signature or
  remove those assets.
- **GET A TRACK** downloads SoundCloud tracks through a third-party site. That's a grey area for a public download;
  you may want to leave it out of the public copy.
- **Code signing**: without it, SmartScreen warns on every download and some antivirus tools flag HyperCore.exe.
  Free options for open-source projects: SignPath Foundation, or Azure Trusted Signing (paid, cheap).

## Updates for your friends (the UPDATE button)

The app checks `https://github.com/Subashton7/Hyperspace` (a **public** repo) for new Releases, every few hours and a
little after it starts. Settings → General → UPDATES shows "Version X is ready" and an **UPDATE** button. One click
downloads it and restarts into it. Notes and settings are not touched.

To ship a new version:

1. Raise `"version"` in `package.json` (for example 0.14.0), commit it.
2. Tag and push: `git tag v0.14.0` then `git push origin main v0.14.0`.
3. GitHub builds it and attaches the installer plus `latest.yml` (the file the update check reads) to the Release.
   If `latest.yml` is missing from the Release, nobody sees the update.

Friends on a version from before this existed (0.13.x) have no UPDATE button: they install the first updater version by
hand once (the installer from the Release), and from then on it's one click.
The repo must stay public, or the update check can't read it without a login.
