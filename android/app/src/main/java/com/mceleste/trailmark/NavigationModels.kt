package com.mceleste.trailmark

data class TrailmarkPoint(
    val latitude: Double,
    val longitude: Double,
    val elevationM: Double? = null,
    val timestampMs: Long? = null
)

data class TrailmarkRoute(
    val id: String,
    val name: String,
    val kind: String = "recorded",
    val points: List<TrailmarkPoint>,
    val distanceMeters: Double,
    val metadataJson: String? = null
)

data class TrailmarkFix(
    val latitude: Double,
    val longitude: Double,
    val speedMps: Double?,
    val bearingDeg: Double?,
    val altitudeM: Double?,
    val timestampMs: Long,
    val horizontalAccuracyM: Double?
)

// A community trail's geometry only — see sql/schema.sql's global_trails
// table and GroupRepository.listGlobalTrails(). Deliberately no name or
// contributor: those rows never carry one either.
data class GlobalTrail(val id: String, val points: List<TrailmarkPoint>)

// One crew member's last-known position, from the `locations` table —
// see GroupRepository.listCrewLocations(). displayName is looked up via
// the `profiles` embed, same as the web app.
data class CrewLocation(val userId: String, val displayName: String, val latitude: Double, val longitude: Double)

data class TrailmarkGroup(val id: String, val name: String)

enum class NavigationStatus { IDLE, NAVIGATING, ARRIVED, OFF_ROUTE }

enum class ManeuverDirection { STRAIGHT, LEFT, RIGHT, SHARP_LEFT, SHARP_RIGHT }

data class TrailmarkManeuver(
    val pointIndex: Int,
    val direction: ManeuverDirection,
    val instruction: String,
    val distanceMeters: Double,
    val turnDegrees: Double
)

data class NavigationState(
    val status: NavigationStatus = NavigationStatus.IDLE,
    val routeId: String? = null,
    val distanceRemainingMeters: Double? = null,
    val distanceTraveledMeters: Double? = null,
    val progress: Double? = null,
    val nextPointIndex: Int? = null,
    val distanceToNextPointMeters: Double? = null,
    val nextManeuver: TrailmarkManeuver? = null,
    val currentFix: TrailmarkFix? = null
)
