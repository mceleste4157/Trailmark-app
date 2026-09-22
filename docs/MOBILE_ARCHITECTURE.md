# Trailmark Mobile + In-Car Architecture

## Goal

Add native iOS and Android applications around the existing Trailmark web/PWA without replacing the working browser app.

The native apps provide:
- iOS location/background execution and Apple CarPlay integration.
- Android location/background execution and Android Auto integration.
- Native offline storage/map resources where browser Cache Storage is not sufficient.
- A shared navigation state model so the same trail/route data can drive phone and vehicle displays.

## Existing web app

The current app is a local-first HTML/CSS/JavaScript PWA using MapLibre GL JS, Dexie/IndexedDB, browser Geolocation, a service worker, Supabase, GPX, trail recording, route planning, and custom offline map downloads.

Important existing stores:
- `trails`: recorded and planned routes.
- `waypoints`: saved points.
- `breadcrumbs`: passive location history.
- `customAreas`: metadata for browser-cached offline map areas.
- `photos`, `vehicles`, `maintenanceRecords`, `tripFolders`.

The current route planner stores straight-line points selected by the user. It is not yet a turn-by-turn routing engine.

## Native architecture

```
Trailmark
├── Web/PWA                 # existing browser experience
├── ios/
│   └── Trailmark           # native iOS shell + navigation engine
│       └── CarPlay         # CPMapTemplate vehicle UI
├── android/
│   └── Trailmark           # native Android shell + navigation engine
│       └── Auto            # Android for Cars navigation UI
└── docs/
    └── MOBILE_ARCHITECTURE.md
```

The native apps should share the same Supabase account/data model and use the same conceptual Trail/Waypoint/Route objects.

## Navigation engine

Build one platform-neutral navigation contract around these concepts:

- Current GPS fix: latitude, longitude, speed, bearing, altitude, timestamp.
- Active route: ordered coordinates plus route metadata.
- Route progress: distance traveled, remaining distance, percent complete.
- Next maneuver: maneuver type, distance to maneuver, target coordinate, instruction.
- Off-route state: whether the vehicle has moved materially away from the active route.
- Destination: coordinate/name and arrival state.

For the first native milestone, support navigation along a saved Trailmark route. Do not assume road-style turn instructions until a routing/maneuver provider is integrated.

## Offline maps

The browser implementation downloads vector tiles into Cache Storage. Native apps should eventually maintain a native tile/resource store. The native layer must not depend on the browser service worker for CarPlay/Android Auto operation.

Offline route data should be stored separately from map tiles so a saved route remains navigable even if map resources are unavailable.

## CarPlay

The iOS app will expose Trailmark as a navigation app using Apple's CarPlay navigation APIs. The vehicle UI should remain intentionally simple:

1. Start/resume navigation.
2. Current route/map.
3. Next maneuver and distance.
4. Route overview.
5. Stop navigation.

Phone-only editing and complex trail management stay on the iPhone.

## Android Auto

The Android app will expose the same navigation state through Android for Cars App Library navigation templates. The vehicle UI should mirror the CarPlay information architecture while following Android Auto's template and driver-distraction requirements.

## Initial implementation sequence

1. Create native project shells and the shared navigation contract.
2. Add native GPS/location service.
3. Add saved-route loading from local storage/backend.
4. Implement route-following progress and off-route detection.
5. Add iOS CarPlay navigation UI.
6. Add Android Auto navigation UI.
7. Add native offline map/resource storage.
8. Test with an actual vehicle/head unit on both platforms.

## Important constraint

Do not remove or rewrite the existing PWA. The native apps are a second client of the Trailmark data model. Changes to the shared data contract should preserve backwards compatibility with existing IndexedDB/Supabase records.
