package com.mceleste.trailmark

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.navigation.model.Destination
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.navigation.model.Trip
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarText
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.snapshotter.MapSnapshotter
import java.util.TimeZone
import java.util.concurrent.TimeUnit

class NavigationScreen(carContext: CarContext, private val selectedRoute: TrailmarkRoute) : Screen(carContext) {
    private val follower = RouteFollower()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val navigationManager = carContext.getCarService(NavigationManager::class.java)
    private val locationService = LocationService(carContext, ::handleFix)

    private var surface: SurfaceContainer? = null
    private var snapshotter: MapSnapshotter? = null
    private var snapshotInProgress = false
    private var snapshotPending = false
    private var snapshotGeneration = 0L
    private var navigationActive = false
    private var autoDriveIndex = 0
    private val autoDriveRunnable = object : Runnable {
        override fun run() {
            if (!navigationActive || selectedRoute.points.isEmpty()) return
            val point = selectedRoute.points[autoDriveIndex]
            handleFix(
                TrailmarkFix(
                    latitude = point.latitude,
                    longitude = point.longitude,
                    speedMps = AUTO_DRIVE_SPEED_MPS,
                    bearingDeg = null,
                    altitudeM = point.elevationM,
                    timestampMs = System.currentTimeMillis(),
                    horizontalAccuracyM = 3.0
                )
            )
            if (navigationActive && autoDriveIndex < selectedRoute.points.lastIndex) {
                val step = (selectedRoute.points.lastIndex / AUTO_DRIVE_MAX_STEPS).coerceAtLeast(1)
                autoDriveIndex = (autoDriveIndex + step).coerceAtMost(selectedRoute.points.lastIndex)
                mainHandler.postDelayed(this, AUTO_DRIVE_INTERVAL_MS)
            }
        }
    }

    init {
        follower.start(selectedRoute)
        navigationManager.setNavigationManagerCallback(
            ContextCompat.getMainExecutor(carContext),
            object : NavigationManagerCallback {
                override fun onStopNavigation() {
                    finishNavigation(clearState = true)
                    if (screenManager.stackSize > 1) screenManager.pop()
                }

                override fun onAutoDriveEnabled() {
                    startAutoDrive()
                }
            }
        )
        navigationManager.navigationStarted()
        navigationActive = true
        startForegroundNavigation(currentCue())
        publishTrip()
        try { locationService.start() } catch (_: SecurityException) {}
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                finishNavigation(clearState = true)
                navigationManager.clearNavigationManagerCallback()
            }
        })

        carContext.getCarService(androidx.car.app.AppManager::class.java)
            .setSurfaceCallback(object : SurfaceCallback {
                override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
                    surface = surfaceContainer
                    redrawSurface()
                }

                override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
                    if (surface === surfaceContainer) {
                        surface = null
                        snapshotGeneration++
                        snapshotter?.cancel()
                        snapshotter = null
                        snapshotInProgress = false
                        snapshotPending = false
                    }
                }
            })
    }

    override fun onGetTemplate(): androidx.car.app.model.Template {
        val state = follower.state
        val remaining = state.distanceRemainingMeters ?: selectedRoute.distanceMeters
        val cue = when (state.status) {
            NavigationStatus.ARRIVED -> "Arrived at destination"
            NavigationStatus.OFF_ROUTE -> "Off route - return to the trail"
            else -> state.nextManeuver?.instruction ?: "Continue on trail"
        }

        val step = Step.Builder(CarText.Builder(cue).build()).build()
        val stepDistance = state.nextManeuver?.distanceMeters ?: remaining
        val routing = RoutingInfo.Builder()
            .setCurrentStep(step, Distance.create(stepDistance, Distance.UNIT_METERS))
            .build()

        val eta = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(
            (remaining / 5.0).coerceAtLeast(0.0).toLong()
        )
        val estimate = TravelEstimate.Builder(
            Distance.create(remaining, Distance.UNIT_METERS),
            DateTimeWithZone.create(eta, TimeZone.getDefault())
        )
            .setRemainingTimeSeconds((remaining / 5.0).coerceAtLeast(0.0).toLong())
            .build()

        return NavigationTemplate.Builder()
            .setNavigationInfo(routing)
            .setDestinationTravelEstimate(estimate)
            .setActionStrip(ActionStrip.Builder()
                .addAction(Action.APP_ICON)
                .addAction(Action.Builder()
                    .setTitle("Stop")
                    .setOnClickListener {
                        finishNavigation(clearState = true)
                        screenManager.pop()
                    }
                    .build())
                .build())
            .build()
    }

    private fun handleFix(fix: TrailmarkFix) {
        if (!navigationActive) return
        follower.update(fix)
        publishTrip()
        updateNavigationNotification(currentCue())
        invalidate()
        redrawSurface()
        if (follower.state.status == NavigationStatus.ARRIVED) {
            finishNavigation(clearState = false)
        }
    }

    private fun finishNavigation(clearState: Boolean) {
        mainHandler.removeCallbacks(autoDriveRunnable)
        snapshotGeneration++
        snapshotter?.cancel()
        snapshotter = null
        snapshotInProgress = false
        snapshotPending = false
        locationService.stop()
        carContext.stopService(Intent(carContext, NavigationForegroundService::class.java))
        if (navigationActive) {
            navigationActive = false
            navigationManager.navigationEnded()
        }
        if (clearState) follower.stop()
    }

    private fun startForegroundNavigation(instruction: String) {
        val intent = navigationServiceIntent(instruction)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            carContext.startForegroundService(intent)
        } else {
            carContext.startService(intent)
        }
    }

    private fun updateNavigationNotification(instruction: String) {
        carContext.startService(navigationServiceIntent(instruction))
    }

    private fun navigationServiceIntent(instruction: String) =
        Intent(carContext, NavigationForegroundService::class.java)
            .putExtra(NavigationForegroundService.EXTRA_INSTRUCTION, instruction)

    private fun publishTrip() {
        if (!navigationActive) return
        val state = follower.state
        val remaining = (state.distanceRemainingMeters ?: selectedRoute.distanceMeters).coerceAtLeast(0.0)
        val stepDistance = (state.nextManeuver?.distanceMeters ?: remaining).coerceAtLeast(0.0)
        val step = Step.Builder(currentCue())
            .setManeuver(Maneuver.Builder(maneuverType(state.nextManeuver?.direction)).build())
            .build()
        val destination = Destination.Builder().setName(selectedRoute.name).build()

        navigationManager.updateTrip(
            Trip.Builder()
                .addStep(step, travelEstimate(stepDistance))
                .addDestination(destination, travelEstimate(remaining))
                .setCurrentRoad(selectedRoute.name)
                .build()
        )
    }

    private fun travelEstimate(distanceMeters: Double): TravelEstimate {
        val remainingSeconds = (distanceMeters / AUTO_DRIVE_SPEED_MPS).coerceAtLeast(0.0).toLong()
        return TravelEstimate.Builder(
            Distance.create(distanceMeters, Distance.UNIT_METERS),
            DateTimeWithZone.create(
                System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(remainingSeconds),
                TimeZone.getDefault()
            )
        ).setRemainingTimeSeconds(remainingSeconds).build()
    }

    private fun currentCue(): String = when (follower.state.status) {
        NavigationStatus.ARRIVED -> "Arrived at ${selectedRoute.name}"
        NavigationStatus.OFF_ROUTE -> "Off route - return to the trail"
        else -> follower.state.nextManeuver?.instruction ?: "Continue on trail"
    }

    private fun maneuverType(direction: ManeuverDirection?): Int = when (direction) {
        ManeuverDirection.LEFT -> Maneuver.TYPE_TURN_NORMAL_LEFT
        ManeuverDirection.RIGHT -> Maneuver.TYPE_TURN_NORMAL_RIGHT
        ManeuverDirection.SHARP_LEFT -> Maneuver.TYPE_TURN_SHARP_LEFT
        ManeuverDirection.SHARP_RIGHT -> Maneuver.TYPE_TURN_SHARP_RIGHT
        ManeuverDirection.STRAIGHT, null -> Maneuver.TYPE_STRAIGHT
    }

    private fun startAutoDrive() {
        if (!navigationActive || selectedRoute.points.isEmpty()) return
        locationService.stop()
        autoDriveIndex = 0
        mainHandler.removeCallbacks(autoDriveRunnable)
        mainHandler.post(autoDriveRunnable)
    }

    private fun redrawSurface() {
        val container = surface ?: return
        if (container.surface == null || container.width <= 0 || container.height <= 0) return
        if (snapshotInProgress) {
            snapshotPending = true
            return
        }

        val fix = follower.state.currentFix
        val options = MapSnapshotter.Options(container.width, container.height)
            .withPixelRatio((container.dpi / 160f).coerceAtLeast(1f))
            .withStyleBuilder(TrailmarkMapStyle.builder(selectedRoute, fix))
            .withLogo(false)
            .withAttribution(false)

        if (fix == null) {
            options.withRegion(TrailmarkMapStyle.bounds(selectedRoute))
                .withPadding(64, 64, 64, 64)
        } else {
            options.withCameraPosition(
                CameraPosition.Builder()
                    .target(LatLng(fix.latitude, fix.longitude))
                    .bearing(fix.bearingDeg ?: 0.0)
                    .zoom(NAVIGATION_ZOOM)
                    .tilt(NAVIGATION_TILT)
                    .build()
            )
        }

        snapshotInProgress = true
        snapshotPending = false
        val generation = ++snapshotGeneration
        snapshotter = MapSnapshotter(carContext, options).also { renderer ->
            renderer.start(
                { snapshot -> completeSnapshot(generation, snapshot.bitmap) },
                { completeSnapshot(generation, null) }
            )
        }
    }

    private fun completeSnapshot(generation: Long, bitmap: Bitmap?) {
        if (generation != snapshotGeneration) return
        if (bitmap != null) drawSnapshot(bitmap)
        snapshotter = null
        snapshotInProgress = false
        if (snapshotPending && navigationActive) redrawSurface()
    }

    private fun drawSnapshot(bitmap: Bitmap) {
        val target = surface?.surface ?: return
        if (!target.isValid) return
        val canvas = try {
            target.lockCanvas(null) ?: return
        } catch (_: Exception) {
            return
        }
        try {
            canvas.drawBitmap(bitmap, null, Rect(0, 0, canvas.width, canvas.height), null)
        } finally {
            target.unlockCanvasAndPost(canvas)
        }
    }

    companion object {
        private const val AUTO_DRIVE_SPEED_MPS = 5.0
        private const val AUTO_DRIVE_INTERVAL_MS = 1000L
        private const val AUTO_DRIVE_MAX_STEPS = 60
        private const val NAVIGATION_ZOOM = 15.5
        private const val NAVIGATION_TILT = 45.0
    }
}
