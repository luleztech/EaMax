# EaAdmin

**React Native** admin app (Android). Not Flutter.

## Run admin

```bash
cd EaAdmin
npm install
./run-admin.sh          # Metro (terminal 1)
npm run android         # terminal 2 — device or emulator
```

## Do not use `flutter run` here for admin

`flutter run` in this folder only shows a short **guard** screen (EaAdmin is not on web).

## EaMax user app (Flutter)

From repo root:

```bash
./scripts/run-chrome.sh
```

Or: `flutter run -d chrome --release` from `/home/ayoub/MySecretes/EaMax` (not `EaAdmin/`).
