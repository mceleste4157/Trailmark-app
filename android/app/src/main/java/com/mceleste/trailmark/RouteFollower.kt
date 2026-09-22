package com.mceleste.trailmark

import android.location.Location
import kotlin.math.max
import kotlin.math.min

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
            distanceToNextPointMeters = null
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
}
