package com.mceleste.trailmark

data class TrailmarkPoint(
    val latitude: Double,
    val longitude: Double
)

data class TrailmarkRoute(
    val id: String,
    val name: String,
    val points: List<TrailmarkPoint>,
    val distanceMeters: Double
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

enum class NavigationStatus { IDLE, NAVIGATING, ARRIVED, OFF_ROUTE }

data class NavigationState(
    val status: NavigationStatus = NavigationStatus.IDLE,
    val routeId: String? = null,
    val distanceRemainingMeters: Double? = null,
    val distanceTraveledMeters: Double? = null,
    val progress: Double? = null,
    val nextPointIndex: Int? = null,
    val distanceToNextPointMeters: Double? = null,
    val currentFix: TrailmarkFix? = null
)
