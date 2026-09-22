package com.mceleste.trailmark

import androidx.car.app.Screen
import androidx.car.app.Session

class TrailmarkSession : Session() {
    override fun onCreateScreen(intent: android.content.Intent): Screen {
        return NavigationScreen(carContext)
    }
}
