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

The native clients currently support navigation along saved Trailmark route geometry. Route followers on iOS and Android compute progress, off-route/arrival state, and the next geometry-derived maneuver by scanning ahead for significant bearing changes in the stored trail polyline. These maneuvers are intentionally off-road cues, not road-network directions from a routing service.

Current maneuver thresholds:
- 35 degrees or greater: left/right cue.
- 100 degrees or greater: sharp left/sharp right cue.
- No remaining significant turn: continue to the end of the trail.

## Offline maps

The browser implementation downloads vector tiles into Cache Storage. Native apps should eventually maintain a native tile/resource store. The native layer must not depend on the browser service worker for CarPlay/Android Auto operation.

Offline route data is stored separately from map tiles so a saved route remains navigable even if map resources are unavailable. Android persists routes and ordered route points in SQLite (`OfflineRouteStore`). iOS persists the last successful route snapshot atomically in Application Support (`OfflineRouteStore`). Both native repositories cache successful Supabase route fetches and fall back to cached routes when offline.

The offline map renderer stays separate from route storage:
- Android uses MapLibre Native offline regions keyed by Trailmark route id, with padded route bounds and zoom levels 8-16.
- MapLibre owns the native tile-region database; Trailmark stores route id and name in each region's metadata.
- Render saved trail geometry from the native route store over the map renderer.
- Allow navigation to continue from cached route geometry even when a map tile region is missing or partially downloaded.

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

During active navigation, `NavigationScreen` owns the Android Auto navigation
lifecycle. It publishes step and destination estimates through
`NavigationManager`, responds to host stop requests, updates an extended car
navigation notification, and can simulate progress along route geometry when
the host enables test-drive mode. Assistant/Gemini `geo:` navigation intents
are routed to the saved-route picker, with matching route names prioritized.
The phone activity and Android Auto surface both render the selected route with
MapLibre Native. Before a GPS fix, the vehicle surface frames the route; during
navigation it uses a centered, heading-up camera and overlays the current fix.

## Crew groups and community trails

The web app lets a signed-in user create or join a named, password-protected
group so their crew can see each other's live location, chat, and shared
waypoints/trails/photos (see sql/schema.sql's "Crew groups" section:
create_group/join_group/leave_group/my_group are SECURITY DEFINER RPC
functions, so the password is never readable client-side). It also
anonymously contributes every GPS-recorded trail to a public, app-wide
`global_trails` layer (no user/creator column at all).

Both are ported to Android: `GroupRepository.kt` calls the same RPCs over
plain REST, the bottom bar's Chat button opens a join/create/leave crew
flow, `onLocationFix` broadcasts presence to the group every 15s, other
members render as dots on the phone map, and a "Community Trails" item in
the Layers menu renders `global_trails` as a line layer. Android doesn't
record new trails itself (Go & Track centers the map rather than starting a
GPS recording — routes come from Supabase/offline storage), so there's
nothing for it to contribute, only display.

iOS includes a native MapKit phone map with the Trailmark top controls, live
location stats, saved-route geometry, route selection, account access, crew
management, and the same five-item bottom navigation used by Android. Crew
membership and this device's presence broadcast are implemented through
`SupabaseGroups.swift`. Rendering other crew members and community trails on
the iOS map remains follow-up work; CarPlay stays focused on turn-by-turn
navigation and does not show those collaborative overlays.

Chat itself (free-text messaging) is not ported to either native platform.
It's phone-only on the web app already; a native equivalent is a real build
(message list UI, input, persistence) with no existing native surface to
extend, not a small addition — deferred rather than done partially.

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
