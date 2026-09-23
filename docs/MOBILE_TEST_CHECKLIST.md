# Trailmark Mobile / In-Car Test Checklist

## iOS

1. Generate/open the Xcode project from ios/project.yml or add the ios/Trailmark sources to an iOS target.
2. Set a real Apple Developer team and registered bundle identifier.
3. Request/enable Apple navigation CarPlay entitlement in Signing & Capabilities.
4. Install on a physical iPhone.
5. Sign in using a Trailmark Supabase account.
6. Grant location access.
7. Connect to a CarPlay-capable vehicle or use the CarPlay Simulator.
8. Open Trailmark -> Routes.
9. Select a saved Trailmark route.
10. Verify route preview, navigation start, GPS position, next maneuver, remaining distance, off-route state, and arrival state.
11. Disable network after a successful route load and verify the route list still shows cached routes.
12. Lock the phone or background the app during active navigation and verify location updates continue.

## Android

1. Open android/ in Android Studio and sync Gradle.
2. Install on a physical Android phone.
3. Grant location permission.
4. Sign in using a Trailmark Supabase account.
5. Connect Android Auto or use the Desktop Head Unit.
6. Launch Trailmark as a navigation app.
7. Verify saved routes appear in the Android Auto route picker.
8. Select a route and verify the navigation template, next maneuver, remaining distance, GPS updates, stop navigation, and off-route state.
9. Disable network after a successful route load and verify the route picker still shows cached routes.
10. Verify Trailmark shows an active foreground-service notification during navigation and removes it after stopping navigation.

## Known release blockers

- Native map tile renderer/offline map store is still separate from the browser service worker and has not been implemented yet.
- Apple CarPlay navigation entitlement approval/signing is required for distribution.
- Android Auto distribution and car-app quality requirements must be completed before Play Store release.
- The native navigation engine derives simple left/right/sharp maneuver cues from saved Trailmark geometry. More advanced spoken guidance, switchback handling, and trail-junction semantics still need hardware/simulator validation.
- Real vehicle/head-unit validation must be performed on hardware or official simulators; it cannot be completed from GitHub alone.
