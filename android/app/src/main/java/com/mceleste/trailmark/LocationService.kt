package com.mceleste.trailmark

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager

class LocationService(context: Context, private val onFix: (TrailmarkFix) -> Unit) : LocationListener {
    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    @SuppressLint("MissingPermission")
    fun start() {
        if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            manager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                1000L,
                3f,
                this
            )
        }
    }

    fun stop() {
        manager.removeUpdates(this)
    }

    override fun onLocationChanged(location: Location) {
        onFix(
            TrailmarkFix(
                latitude = location.latitude,
                longitude = location.longitude,
                speedMps = if (location.hasSpeed()) location.speed.toDouble() else null,
                bearingDeg = if (location.hasBearing()) location.bearing.toDouble() else null,
                altitudeM = if (location.hasAltitude()) location.altitude else null,
                timestampMs = location.time,
                horizontalAccuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null
            )
        )
    }
}
