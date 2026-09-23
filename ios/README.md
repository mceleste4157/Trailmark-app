# Trailmark iOS / CarPlay

Native iOS foundation for Trailmark.

## Included

- Core Location service with Always authorization.
- Background location capability configuration.
- Platform-neutral Trailmark route models.
- Native route-following engine with nearest-point progress, remaining distance, arrival detection, and off-route detection.
- CarPlay scene using `CPMapTemplate`.
- MapKit-backed CarPlay map window.
- Navigation entitlement declaration and CarPlay scene manifest.
- Supabase-backed saved route loading with native offline fallback.
- Atomic native offline route snapshot storage in Application Support.

Apple's navigation integration requires a navigation entitlement and a CarPlay scene whose root template is `CPMapTemplate`. The map window is reserved for map content; driver controls belong in CarPlay templates.

## Xcode setup

The project is generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen) from `project.yml` — `Trailmark.xcodeproj` itself is gitignored and not committed, so you regenerate it locally rather than opening a checked-in project file.

1. `brew install xcodegen` (one-time).
2. `cd ios && xcodegen generate` — creates `Trailmark.xcodeproj`.
3. Open `Trailmark.xcodeproj`, or build from the command line:
   ```
   xcodebuild -project Trailmark.xcodeproj -scheme Trailmark \
     -destination "generic/platform=iOS Simulator" CODE_SIGNING_ALLOWED=NO build
   ```
4. To run on a real device or in CarPlay, set `DEVELOPMENT_TEAM` in `project.yml`'s `settings.base` (or in Xcode's Signing & Capabilities) to your Apple Developer team, then regenerate.
5. The navigation entitlement (`com.apple.developer.navigation-app` in `Trailmark/Trailmark.entitlements`) and the CarPlay scene manifest (in `Trailmark/Info.plist`) are already wired up — Apple's own approval of the production navigation entitlement is still required before it works on a real device/vehicle.

`Trailmark/Info.plist` and `Trailmark/Trailmark.entitlements` are hand-authored and read as-is by the build (`INFOPLIST_FILE`/`CODE_SIGN_ENTITLEMENTS` in `project.yml`) — `project.yml` intentionally has no top-level `info:`/`entitlements:` blocks, since those tell XcodeGen to *generate* those files' content itself (from an `info.properties` dict) and would silently overwrite the location-permission strings, background mode, and CarPlay scene manifest on every `xcodegen generate`.

## Current limitation

The native route repository loads authenticated saved routes from Supabase and stores the last successful route snapshot in native app storage for offline use. The browser app's trails still live in Dexie/IndexedDB, so native apps cannot read browser-only local trails unless those trails have been synced/shared through the backend.

No fake routing provider is used. CarPlay navigation follows saved Trailmark route geometry; a full maneuver-generation engine and production offline map renderer are still future work.
