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

Apple's navigation integration requires a navigation entitlement and a CarPlay scene whose root template is `CPMapTemplate`. The map window is reserved for map content; driver controls belong in CarPlay templates.

## Xcode setup

1. Create an iOS App target named `Trailmark` in Xcode, or add these source files to an existing native target.
2. Use bundle identifier `com.mceleste.trailmark` (or your own registered identifier).
3. Add the CarPlay capability/navigation entitlement through **Signing & Capabilities**. Apple approval is required for the production navigation entitlement.
4. Add the location usage strings and background location mode from `Info.plist`.
5. Add the CarPlay scene configuration from `Info.plist`.
6. Sign with your Apple Developer team.

## Current limitation

The native layer still needs the Trailmark route repository adapter. The browser app's trails live in Dexie/IndexedDB, so the native app cannot read them directly. The next adapter should use the existing Supabase schema for authenticated shared trails and a native local database for downloaded/offline routes.

No fake routing provider is used. Until that adapter is connected, the CarPlay shell is intentionally a foundation rather than a production navigation experience.
