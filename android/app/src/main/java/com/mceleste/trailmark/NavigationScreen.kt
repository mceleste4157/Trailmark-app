package com.mceleste.trailmark

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.navigation.model.Distance
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarText
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class NavigationScreen(carContext: CarContext) : Screen(carContext) {
    private val follower = RouteFollower()
    private val locationService = LocationService(carContext) {
        follower.update(it)
        invalidate()
        redrawSurface()
    }

    private var route: TrailmarkRoute? = null
    private var surface: SurfaceContainer? = null

    init {
        carContext.getCarService(androidx.car.app.AppManager::class.java)
            .setSurfaceCallback(object : SurfaceCallback {
                override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
                    surface = surfaceContainer
                    redrawSurface()
                }

                override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
                    if (surface === surfaceContainer) surface = null
                }
            })

        thread(start = true, name = "trailmark-route-loader") {
            val loaded = RouteRepository(carContext).fetchRoutes().firstOrNull()
            if (loaded != null) {
                route = loaded
                follower.start(loaded)
                try { locationService.start() } catch (_: SecurityException) {}
                invalidate()
                redrawSurface()
            }
        }
    }

    override fun onGetTemplate(): androidx.car.app.model.Template {
        val r = route
        if (r == null) {
            return NavigationTemplate.Builder()
                .setNavigationInfo(RoutingInfo.Builder().setLoading(true).build())
                .setActionStrip(ActionStrip.Builder().addAction(Action.APP_ICON).build())
                .build()
        }

        val state = follower.state
        val remaining = state.distanceRemainingMeters ?: r.distanceMeters
        val cue = when (state.status) {
            NavigationStatus.ARRIVED -> "Arrived at destination"
            NavigationStatus.OFF_ROUTE -> "Off route — return to the trail"
            else -> "Continue on trail"
        }

        val step = Step.Builder(CarText.Builder(cue).build()).build()
        val routing = RoutingInfo.Builder()
            .setCurrentStep(step, Distance.create(remaining, Distance.UNIT_METERS))
            .build()

        val eta = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(
            (remaining / 5.0).coerceAtLeast(0.0).toLong()
        )
        val estimate = TravelEstimate.Builder(
            Distance.create(remaining, Distance.UNIT_METERS),
            eta
        ).build()

        return NavigationTemplate.Builder()
            .setNavigationInfo(routing)
            .setDestinationTravelEstimate(estimate)
            .setActionStrip(ActionStrip.Builder().addAction(Action.APP_ICON).build())
            .build()
    }

    private fun redrawSurface() {
        val container = surface ?: return
        val s = container.surface
        val canvas: Canvas = try {
            s.lockCanvas(null) ?: return
        } catch (_: Exception) {
            return
        }

        try {
            canvas.drawColor(Color.rgb(20, 24, 28))
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.STROKE
                strokeWidth = 8f
            }
            val r = route
            if (r != null && r.points.isNotEmpty()) {
                val path = Path()
                r.points.forEachIndexed { index, p ->
                    val x = 100f + index * 20f
                    val y = 250f + kotlin.math.sin(index / 5.0) * 80f + 300f
                    if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                canvas.drawPath(path, paint)
            }
        } finally {
            s.unlockCanvasAndPost(canvas)
            s.release()
        }
    }
}
