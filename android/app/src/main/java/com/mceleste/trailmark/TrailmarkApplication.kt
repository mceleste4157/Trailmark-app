package com.mceleste.trailmark

import android.app.Application
import org.maplibre.android.MapLibre

class TrailmarkApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
    }
}
