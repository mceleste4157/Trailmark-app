package com.mceleste.trailmark

import android.location.Location
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class RouteFollower {
    private var route: TrailmarkRoute? = null
    var state: NavigationState = NavigationState()
        private set

    private val offRouteThresholdM = 75f
    private val arrivalThresholdM = 30.0

    fun start(route: TrailmarkRoute) {
        this.route = route
        state = NavigationState(
            status = NavigationStatus.NAVIGATING,
            routeId = route.id,
            distanceRemainingMeters = route.distanceMeters,
            distanceTraveledMeters = 0.0,
            progress = 0.0,
            nextPointIndex = min(1, max(0, route.points.lastIndex)),
            distanceToNextPointMeters = null,
            nextManeuver = nextManeuver(startIndex = 0, route = route)
        )
    }

    fun stop() {
        route = null
        state = NavigationState()
    }

    fun update(fix: TrailmarkFix) {
        val r = route ?: return
        if (r.points.size < 2) return

        var bestIndex = 0
        var bestDistance = Float.MAX_VALUE
        for (i in r.points.indices) {
            val d = FloatArray(1)
            Location.distanceBetween(
                fix.latitude, fix.longitude,
                r.points[i].latitude, r.points[i].longitude,
                d
            )
            if (d[0] < bestDistance) {
                bestDistance = d[0]
                bestIndex = i
            }
        }

        val nextIndex = min(bestIndex + 1, r.points.lastIndex)
        val remaining = distanceFrom(bestIndex, r.points.lastIndex, r)
        val total = max(r.distanceMeters, 1.0)
        val traveled = max(0.0, total - remaining)
        val progress = min(1.0, max(0.0, traveled / total))

        val nextDistance = FloatArray(1)
        Location.distanceBetween(
            fix.latitude, fix.longitude,
            r.points[nextIndex].latitude, r.points[nextIndex].longitude,
            nextDistance
        )

        val status = when {
            remaining <= arrivalThresholdM -> NavigationStatus.ARRIVED
            bestDistance > offRouteThresholdM -> NavigationStatus.OFF_ROUTE
            else -> NavigationStatus.NAVIGATING
        }

        state = state.copy(
            status = status,
            distanceRemainingMeters = remaining,
            distanceTraveledMeters = traveled,
            progress = progress,
            nextPointIndex = nextIndex,
            distanceToNextPointMeters = nextDistance[0].toDouble(),
            nextManeuver = nextManeuver(startIndex = bestIndex, route = r),
            currentFix = fix
        )
    }

    private fun distanceFrom(start: Int, end: Int, route: TrailmarkRoute): Double {
        if (start >= end) return 0.0
        var total = 0.0
        val result = FloatArray(1)
        for (i in start until end) {
            val a = route.points[i]
            val b = route.points[i + 1]
            Location.distanceBetween(a.latitude, a.longitude, b.latitude, b.longitude, result)
            total += result[0]
        }
        return total
    }

    private fun nextManeuver(startIndex: Int, route: TrailmarkRoute): TrailmarkManeuver? {
        if (route.points.size < 3) return null
        val start = max(1, startIndex + 1)
        for (i in start until route.points.lastIndex) {
            val incoming = bearing(route.points[i - 1], route.points[i])
            val outgoing = bearing(route.points[i], route.points[i + 1])
            val turn = normalizeTurn(outgoing - incoming)
            val magnitude = kotlin.math.abs(turn)
            if (magnitude >= TURN_THRESHOLD_DEGREES) {
                val direction = when {
                    turn <= -SHARP_TURN_THRESHOLD_DEGREES -> ManeuverDirection.SHARP_LEFT
                    turn < 0 -> ManeuverDirection.LEFT
                    turn >= SHARP_TURN_THRESHOLD_DEGREES -> ManeuverDirection.SHARP_RIGHT
                    else -> ManeuverDirection.RIGHT
                }
                val distance = distanceFrom(startIndex, i, route)
                return TrailmarkManeuver(
                    pointIndex = i,
                    direction = direction,
                    instruction = instruction(direction),
                    distanceMeters = distance,
                    turnDegrees = turn
                )
            }
        }
        return TrailmarkManeuver(
            pointIndex = route.points.lastIndex,
            direction = ManeuverDirection.STRAIGHT,
            instruction = "Continue to the end of the trail",
            distanceMeters = distanceFrom(startIndex, route.points.lastIndex, route),
            turnDegrees = 0.0
        )
    }

    private fun instruction(direction: ManeuverDirection): String = when (direction) {
        ManeuverDirection.SHARP_LEFT -> "Sharp left ahead"
        ManeuverDirection.LEFT -> "Turn left ahead"
        ManeuverDirection.RIGHT -> "Turn right ahead"
        ManeuverDirection.SHARP_RIGHT -> "Sharp right ahead"
        ManeuverDirection.STRAIGHT -> "Continue on trail"
    }

    private fun bearing(a: TrailmarkPoint, b: TrailmarkPoint): Double {
        val lat1 = Math.toRadians(a.latitude)
        val lat2 = Math.toRadians(b.latitude)
        val deltaLon = Math.toRadians(b.longitude - a.longitude)
        val y = sin(deltaLon) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLon)
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    private fun normalizeTurn(turn: Double): Double {
        var normalized = turn
        while (normalized > 180.0) normalized -= 360.0
        while (normalized < -180.0) normalized += 360.0
        return normalized
    }

    companion object {
        private const val TURN_THRESHOLD_DEGREES = 35.0
        private const val SHARP_TURN_THRESHOLD_DEGREES = 100.0
    }
}
