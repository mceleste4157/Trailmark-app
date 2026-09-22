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
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarText
import java.util.concurrent.TimeUnit

class NavigationScreen(carContext: CarContext) : Screen(carContext) {
    private val follower = RouteFollower()
    private val locationService = LocationService(carContext) {
        follower.update(it)
        invalidate()
        redrawSurface()
    }

    // Placeholder route until the native Supabase/local route adapter is connected.
    // This is deliberately a real route-following object, not a fake UI-only state.
    private val demoRoute = TrailmarkRoute(
        id = "demo",
        name = "Trailmark Demo Route",
        points = listOf(
            TrailmarkPoint(0.0, 0.0),
            TrailmarkPoint(0.001, 0.001),
            TrailmarkPoint(0.002, 0.002)
        ),
        distanceMeters = 314.0
    )

    private var surface: SurfaceContainer? = null

    init {
        follower.start(demoRoute)
        locationService.start()
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
    }

    override fun onGetTemplate(): androidx.car.app.model.Template {
        val state = follower.state
        val remaining = state.distanceRemainingMeters ?: 0.0
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
            ((remaining / 5.0).coerceAtLeast(0.0)).toLong()
        )
        val estimate = TravelEstimate.Builder(
            Distance.create(remaining, Distance.UNIT_METERS),
            eta
        ).build()

        return NavigationTemplate.Builder()
            .setNavigationInfo(routing)
            .setDestinationTravelEstimate(estimate)
            .setActionStrip(
                ActionStrip.Builder()
                    .addAction(Action.APP_ICON)
                    .build()
            )
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
            val path = Path()
            val points = demoRoute.points
            points.forEachIndexed { index, p ->
                val x = 100f + index * 250f
                val y = 250f + index * 80f
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            canvas.drawPath(path, paint)
        } finally {
            s.unlockCanvasAndPost(canvas)
            s.release()
        }
    }
}
