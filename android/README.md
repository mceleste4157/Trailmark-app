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

Google's current documentation requires navigation apps to declare the navigation template permission and the navigation app category. Android Auto discovery also requires the automotive app descriptor.

## Build

Open the `android/` directory in Android Studio and let Gradle sync.

## Current limitation

`NavigationScreen.kt` currently contains a small placeholder route so the navigation pipeline can be exercised. Replace that route with a native Trailmark repository adapter.

The browser app's Dexie/IndexedDB database is not directly available to the Android process. The production adapter should load authenticated Trailmark routes from Supabase and maintain a native offline route store.

Map tiles should eventually be rendered from a native offline-capable map source. The surface renderer is deliberately isolated so that MapLibre/another native renderer can replace the current development drawing without changing the navigation template.

## Production requirements

- Request runtime location permissions.
- Run location access through the appropriate foreground service when needed.
- Replace the development host validator with the production validator before release.
- Test with Android Auto Desktop Head Unit and real compatible head units.
- Complete Google's navigation-app review/distribution requirements.
