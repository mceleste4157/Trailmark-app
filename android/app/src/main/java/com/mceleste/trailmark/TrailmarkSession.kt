package com.mceleste.trailmark

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.Session

class TrailmarkSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen {
        return RouteSelectionScreen(carContext, intent.destinationQuery())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val destination = intent.destinationQuery() ?: return
        val screenManager = carContext.getCarService(ScreenManager::class.java)
        screenManager.popToRoot()
        (screenManager.top as? RouteSelectionScreen)?.showRequestedDestination(destination)
    }

    private fun Intent.destinationQuery(): String? {
        if (action != CAR_ACTION_NAVIGATE) return null
        val uri = data ?: return null
        if (uri.scheme != "geo" && uri.scheme != "geo.offline") return null
        return uri.getQueryParameter("q")?.takeIf { it.isNotBlank() }
            ?: uri.schemeSpecificPart.substringBefore('?').takeIf { it.isNotBlank() && it != "0,0" }
    }

    companion object {
        private const val CAR_ACTION_NAVIGATE = "androidx.car.app.action.NAVIGATE"
    }
}
