package com.mceleste.trailmark

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import java.util.Locale
import kotlin.concurrent.thread

class RouteSelectionScreen(
    carContext: CarContext,
    private var requestedDestination: String? = null
) : Screen(carContext) {
    private var routes: List<TrailmarkRoute> = emptyList()
    private var isLoading = true
    private var loadError: String? = null

    init {
        loadRoutes()
    }

    override fun onGetTemplate(): Template {
        if (isLoading) {
            return MessageTemplate.Builder("Loading saved Trailmark routes")
                .setTitle("Trailmark")
                .setLoading(true)
                .build()
        }

        val error = loadError
        if (error != null) {
            return MessageTemplate.Builder(error)
                .setTitle("Trailmark Routes")
                .addAction(Action.Builder()
                    .setTitle("Retry")
                    .setOnClickListener { loadRoutes() }
                    .build())
                .build()
        }

        val list = ItemList.Builder()
            .setNoItemsMessage("No saved Trailmark routes available")

        for (route in routes) {
            list.addItem(Row.Builder()
                .setTitle(route.name)
                .addText(routeSummary(route))
                .setOnClickListener {
                    screenManager.push(NavigationScreen(carContext, route))
                }
                .build())
        }

        return ListTemplate.Builder()
            .setTitle(requestedDestination?.let { "Routes for $it" } ?: "Trailmark Routes")
            .setSingleList(list.build())
            .setActionStrip(ActionStrip.Builder()
                .addAction(Action.APP_ICON)
                .addAction(Action.Builder()
                    .setTitle("Refresh")
                    .setOnClickListener { loadRoutes() }
                    .build())
                .build())
            .build()
    }

    fun showRequestedDestination(destination: String) {
        requestedDestination = destination
        routes = prioritizeRequestedRoute(routes, destination)
        invalidate()
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private fun loadRoutes() {
        isLoading = true
        loadError = null
        invalidate()

        thread(start = true, name = "trailmark-route-picker-loader") {
            // Screen.invalidate() and the fields it reads back from
            // onGetTemplate() are only safe to touch from the main thread
            // — this hop is what keeps the background fetch from racing
            // the host's next onGetTemplate() call.
            try {
                val fetched = RouteRepository(carContext).fetchRoutes()
                mainHandler.post {
                    routes = requestedDestination?.let { prioritizeRequestedRoute(fetched, it) } ?: fetched
                    loadError = null
                    isLoading = false
                    invalidate()
                }
            } catch (error: Exception) {
                mainHandler.post {
                    routes = emptyList()
                    loadError = error.message ?: "Unable to load Trailmark routes."
                    isLoading = false
                    invalidate()
                }
            }
        }
    }

    private fun routeSummary(route: TrailmarkRoute): String {
        val miles = route.distanceMeters / 1609.344
        return "${route.points.size} points - ${String.format(Locale.getDefault(), "%.1f", miles)} mi"
    }

    private fun prioritizeRequestedRoute(
        candidates: List<TrailmarkRoute>,
        destination: String
    ): List<TrailmarkRoute> = candidates.sortedByDescending {
        it.name.contains(destination, ignoreCase = true)
    }
}
