# Tankōbon Android app

This folder turns the web app (the files at the top of this repository) into an Android app with Capacitor.

- GitHub builds the app file automatically (see `.github/workflows/android.yml`) whenever this folder changes, and publishes it on the repository's **Releases** page as `Tankobon.apk`.
- The app's screens come with the app, and later versions are downloaded from the website only when you tap **Update** in the app (or when automatic updates are switched on).
- Pages are stored as encrypted files in the app's own storage, not in Chrome.
- `keystore/tankobon.jks` signs the app so a newer app file installs over an older one. It only matters for this personal app.
