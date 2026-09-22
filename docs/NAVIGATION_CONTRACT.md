# Trailmark Navigation Contract

This document defines the minimum platform-neutral data model used by the native iOS/Android navigation layers.

## GPS Fix

```text
latitude: number
longitude: number
speedMps: number | null
bearingDeg: number | null
altitudeM: number | null
timestampMs: number
horizontalAccuracyM: number | null
```

## Route

```text
id: string
name: string
kind: "recorded" | "planned"
points: [{ latitude, longitude, altitudeM?, timestampMs? }]
distanceMeters: number
```

## Navigation State

```text
status: "idle" | "navigating" | "arrived" | "off_route"
routeId: string | null
distanceRemainingMeters: number | null
distanceTraveledMeters: number | null
progress: number | null
nextPointIndex: number | null
distanceToNextPointMeters: number | null
currentFix: GPSFix | null
```

## Design notes

- Coordinates are WGS84 latitude/longitude.
- Distances are meters internally; UI may convert to miles/km.
- Bearing is degrees clockwise from true north where the platform provides it.
- The first implementation can use nearest-point/segment projection for route progress.
- Off-route detection should use a configurable distance threshold and hysteresis to avoid rapid state changes.
- Maneuver instructions are deliberately absent from this first contract. A later routing layer can add them without changing basic route-following.
