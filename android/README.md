# Trailmark Android / Android Auto

Native Android foundation for Trailmark's Android Auto navigation client.

## Included

- Android for Cars `CarAppService` with the navigation category.
- `NavigationTemplate` routing information and destination travel estimates.
- Native GPS location listener.
- Route-following/off-route calculation shared conceptually with iOS.
- Android Auto automotive app descriptor.
- Navigation surface callback foundation for drawing a Trailmark route.
- Required `NAVIGATION_TEMPLATES` and `ACCESS_SURFACE` declarations.
- Android Auto route picker using `ListTemplate`.
- Supabase-backed saved route loading with SQLite offline fallback.
- Foreground service wrapper while Android Auto trail navigation is active.
- Android Auto `NavigationManager` lifecycle and trip metadata.
- Navigation-intent handling for Assistant/Gemini destination requests.
- Review/test-drive simulation through `onAutoDriveEnabled`.
- Turn-by-turn navigation notifications with `CarAppExtender`.
- MapLibre Native phone map with saved-route and live GPS overlays.
- Route-bounded MapLibre offline region downloads (zoom levels 8-16).
- MapLibre-rendered Android Auto map surface with route overview and heading-up navigation camera.

Google's current documentation requires navigation apps to declare the navigation template permission and the navigation app category. Android Auto discovery also requires the automotive app descriptor.

## Build

Open the `android/` directory in Android Studio and let Gradle sync. From the repository root you can also run:

```
./android/gradlew -p android assembleDebug
```

The phone app guides the user through foreground location, notification, and
all-the-time location setup. Android 11 and newer require all-the-time location
to be enabled from the app's system settings before Android Auto can start a
location foreground service while the phone UI is in the background.

To trigger Android Auto's review simulation while navigation is active:

```
adb shell dumpsys activity service com.mceleste.trailmark/.TrailmarkCarAppService AUTO_DRIVE
```

## Route and map data

Android Auto now starts on a native route picker and pushes `NavigationScreen` only after a saved trail is selected. `RouteRepository` loads authenticated Trailmark routes from Supabase and caches them in the native SQLite `OfflineRouteStore`; if the user is offline or unauthenticated, the repository returns previously cached routes.

The browser app's Dexie/IndexedDB database is not directly available to the Android process. Browser-only local trails still need to be synced/shared through the backend before native clients can cache them. Select a synced route in the phone app and use **Offline** while connected; Android stores the native style and tiles for the padded route bounds. Repeated downloads reuse or resume the route's existing region.

Both the phone map and Android Auto surface use MapLibre Native with the OpenFreeMap Liberty style. Saved geometry remains available from SQLite even when no map region has been downloaded, so route following and navigation cues do not depend on tile availability.

## Production requirements

- Validate foreground-service notification and location behavior on Android 13+ and Android Auto hardware.
- Verify the release host allowlist against current production Android Auto hosts.
- Test with Android Auto Desktop Head Unit and real compatible head units.
- Complete Google's navigation-app review/distribution requirements.
