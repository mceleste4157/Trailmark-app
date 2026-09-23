package com.mceleste.trailmark

import android.Manifest
import android.content.Intent
import android.content.res.ColorStateList
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var mapView: MapView
    private lateinit var statusView: TextView
    private lateinit var speedView: TextView
    private lateinit var headingView: TextView
    private lateinit var elevationView: TextView
    private lateinit var connectivityView: TextView
    private lateinit var locationService: LocationService
    private lateinit var offlineMapManager: OfflineMapManager

    private var map: MapLibreMap? = null
    private var routes: List<TrailmarkRoute> = emptyList()
    private var activeRoute: TrailmarkRoute? = null
    private var latestFix: TrailmarkFix? = null
    private var locationStarted = false
    private var satelliteMode = false
    private var routeLayerVisible = true
    private var lightChrome = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        applySystemBarInsets()

        mapView = findViewById(R.id.map_view)
        statusView = findViewById(R.id.map_status)
        speedView = findViewById(R.id.stat_speed)
        headingView = findViewById(R.id.stat_heading)
        elevationView = findViewById(R.id.stat_elevation)
        connectivityView = findViewById(R.id.connectivity_status)
        offlineMapManager = OfflineMapManager(this)
        locationService = LocationService(this, ::onLocationFix)

        mapView.onCreate(savedInstanceState)
        mapView.getMapAsync { readyMap ->
            map = readyMap
            readyMap.setStyle(
                TrailmarkMapStyle.builder(
                    if (routeLayerVisible) activeRoute else null,
                    latestFix,
                    satelliteMode,
                ),
            ) {
                statusView.setText(if (routes.isEmpty()) R.string.select_route else R.string.routes)
                activeRoute?.let(::showRoute)
            }
        }

        findViewById<View>(R.id.go_track_button).setOnClickListener { centerMap() }
        findViewById<View>(R.id.tools_button).setOnClickListener { explainNavigationPermissions() }
        findViewById<View>(R.id.my_content_button).setOnClickListener { showRoutePicker() }
        findViewById<View>(R.id.offline_maps_button).setOnClickListener { confirmOfflineDownload() }
        findViewById<View>(R.id.chat_button).setOnClickListener { showSetupMenu() }
        findViewById<View>(R.id.account_button).setOnClickListener { showSetupMenu() }
        findViewById<View>(R.id.basemap_button).setOnClickListener { toggleBasemap() }
        findViewById<View>(R.id.layers_button).setOnClickListener { toggleRouteLayer() }
        findViewById<View>(R.id.weather_button).setOnClickListener { openWeather() }
        findViewById<View>(R.id.theme_button).setOnClickListener { toggleChromeTheme() }

        loadRoutes()
        if (!hasForegroundLocation()) requestForegroundLocation()
    }

    override fun onStart() {
        super.onStart()
        mapView.onStart()
        startLocationIfAllowed()
    }

    override fun onResume() {
        super.onResume()
        mapView.onResume()
        updateConnectivityStatus()
    }

    override fun onPause() {
        mapView.onPause()
        super.onPause()
    }

    override fun onStop() {
        if (locationStarted) {
            locationService.stop()
            locationStarted = false
        }
        mapView.onStop()
        super.onStop()
    }

    override fun onDestroy() {
        mapView.onDestroy()
        super.onDestroy()
    }

    override fun onLowMemory() {
        super.onLowMemory()
        mapView.onLowMemory()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        mapView.onSaveInstanceState(outState)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_FOREGROUND_LOCATION && hasForegroundLocation()) {
            startLocationIfAllowed()
            requestNotificationPermission()
        }
    }

    private fun loadRoutes() {
        statusView.setText(R.string.map_loading)
        thread(start = true, name = "trailmark-phone-route-loader") {
            val loaded = RouteRepository(this).fetchRoutes()
            runOnUiThread {
                routes = loaded
                val selected = activeRoute?.id?.let { id -> loaded.firstOrNull { it.id == id } }
                    ?: loaded.firstOrNull()
                if (selected != null) showRoute(selected) else statusView.setText(R.string.no_routes)
            }
        }
    }

    private fun applySystemBarInsets() {
        val topBar = findViewById<View>(R.id.top_bar)
        val bottomBar = findViewById<View>(R.id.bottom_bar)
        val topPadding = topBar.paddingTop
        val bottomPadding = bottomBar.paddingBottom

        ViewCompat.setOnApplyWindowInsetsListener(topBar) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(view.paddingLeft, topPadding + systemBars.top, view.paddingRight, view.paddingBottom)
            insets
        }
        ViewCompat.setOnApplyWindowInsetsListener(bottomBar) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, bottomPadding + systemBars.bottom)
            insets
        }
    }

    private fun showRoutePicker() {
        if (routes.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle(R.string.routes)
                .setMessage(R.string.no_routes)
                .setPositiveButton(R.string.account) { _, _ -> showSignInDialog() }
                .setNegativeButton(R.string.cancel, null)
                .show()
            return
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.select_route)
            .setItems(routes.map { it.name }.toTypedArray()) { _, index -> showRoute(routes[index]) }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun showRoute(route: TrailmarkRoute) {
        activeRoute = route
        statusView.text = getString(
            R.string.selected_route,
            route.name,
            route.distanceMeters / METERS_PER_MILE
        )
        map?.style?.let {
            TrailmarkMapStyle.updateRoute(it, if (routeLayerVisible) route else null)
        }
        val camera = map?.getCameraForLatLngBounds(
            TrailmarkMapStyle.bounds(route),
            intArrayOf(72, 140, 72, 180)
        )
        if (camera != null) map?.animateCamera(CameraUpdateFactory.newCameraPosition(camera), 700)
    }

    private fun centerMap() {
        if (!hasForegroundLocation()) {
            requestForegroundLocation()
            return
        }
        val fix = latestFix
        if (fix != null) {
            map?.animateCamera(
                CameraUpdateFactory.newCameraPosition(
                    CameraPosition.Builder()
                        .target(LatLng(fix.latitude, fix.longitude))
                        .zoom(15.5)
                        .bearing(fix.bearingDeg ?: 0.0)
                        .tilt(35.0)
                        .build()
                ),
                650
            )
        } else {
            activeRoute?.let(::showRoute)
        }
    }

    private fun onLocationFix(fix: TrailmarkFix) {
        runOnUiThread {
            val firstFix = latestFix == null
            latestFix = fix
            map?.style?.let { TrailmarkMapStyle.updateLocation(it, fix) }
            speedView.text = fix.speedMps?.let {
                getString(R.string.speed_value, (it * MPS_TO_MPH).toInt())
            } ?: getString(R.string.speed_unavailable)
            headingView.text = fix.bearingDeg?.let {
                getString(R.string.heading_value, it.toInt())
            } ?: getString(R.string.heading_unavailable)
            elevationView.text = fix.altitudeM?.let {
                getString(R.string.elevation_value, (it * METERS_TO_FEET).toInt())
            } ?: getString(R.string.elevation_unavailable)
            if (firstFix && activeRoute == null) centerMap()
        }
    }

    private fun toggleBasemap() {
        satelliteMode = !satelliteMode
        findViewById<TextView>(R.id.basemap_button).setText(
            if (satelliteMode) R.string.satellite else R.string.streets
        )
        map?.setStyle(
            TrailmarkMapStyle.builder(
                if (routeLayerVisible) activeRoute else null,
                latestFix,
                satelliteMode,
            ),
        ) {
            activeRoute?.let(::showRoute)
        }
    }

    private fun toggleRouteLayer() {
        routeLayerVisible = !routeLayerVisible
        map?.style?.let { style ->
            TrailmarkMapStyle.updateRoute(style, if (routeLayerVisible) activeRoute else null)
        }
        findViewById<View>(R.id.layers_button).alpha = if (routeLayerVisible) 1f else 0.55f
    }

    private fun openWeather() {
        val fix = latestFix
        if (fix == null) {
            requestForegroundLocation()
            return
        }
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(
            "https://forecast.weather.gov/MapClick.php?lat=${fix.latitude}&lon=${fix.longitude}"
        )))
    }

    private fun toggleChromeTheme() {
        lightChrome = !lightChrome
        val background = Color.parseColor(if (lightChrome) "#F7F1F5F9" else "#F70F172A")
        val panel = Color.parseColor(if (lightChrome) "#FFFFFFFF" else "#CC111827")
        val text = Color.parseColor(if (lightChrome) "#0F172A" else "#E5E7EB")
        val topBar = findViewById<View>(R.id.top_bar)
        val bottomBar = findViewById<View>(R.id.bottom_bar)
        topBar.setBackgroundColor(background)
        bottomBar.setBackgroundColor(background)
        tintText(topBar, text)
        tintText(bottomBar, text)
        listOf(
            R.id.basemap_button,
            R.id.layers_button,
            R.id.weather_button,
            R.id.account_button,
            R.id.theme_button
        ).forEach { id ->
            findViewById<TextView>(id).backgroundTintList = ColorStateList.valueOf(panel)
        }
        findViewById<TextView>(R.id.theme_button).text = if (lightChrome) "☾" else "☀"
        updateConnectivityStatus()
    }

    private fun tintText(view: View, color: Int) {
        if (view is TextView) view.setTextColor(color)
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) tintText(view.getChildAt(index), color)
        }
    }

    private fun updateConnectivityStatus() {
        val manager = getSystemService(ConnectivityManager::class.java)
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
        val online = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        connectivityView.setText(if (online) R.string.online else R.string.offline_status)
        connectivityView.setTextColor(Color.parseColor(if (online) "#22C55E" else "#FACC15"))
    }

    private fun confirmOfflineDownload() {
        val route = activeRoute
        if (route == null) {
            AlertDialog.Builder(this)
                .setMessage(R.string.offline_requires_route)
                .setPositiveButton(android.R.string.ok, null)
                .show()
            return
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.offline)
            .setMessage(getString(R.string.offline_download_started, route.name))
            .setPositiveButton(R.string.download) { _, _ -> downloadOfflineMap(route) }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun downloadOfflineMap(route: TrailmarkRoute) {
        offlineMapManager.downloadRoute(
            route,
            onProgress = { percent ->
                runOnUiThread {
                    statusView.text = getString(R.string.offline_download_progress, route.name, percent)
                }
            },
            onComplete = {
                runOnUiThread {
                    statusView.text = getString(R.string.offline_download_complete, route.name)
                }
            },
            onError = { error ->
                runOnUiThread {
                    statusView.text = getString(R.string.offline_download_failed, error)
                }
            }
        )
    }

    private fun showSetupMenu() {
        val signedIn = SupabaseAuth.token(this) != null
        val items = if (signedIn) {
            arrayOf(getString(R.string.routes), getString(R.string.grant_navigation_permissions))
        } else {
            arrayOf(getString(R.string.sign_in), getString(R.string.grant_navigation_permissions))
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.account)
            .setItems(items) { _, index ->
                when {
                    index == 0 && !signedIn -> showSignInDialog()
                    index == 0 -> loadRoutes()
                    else -> explainNavigationPermissions()
                }
            }
            .show()
    }

    private fun showSignInDialog() {
        val email = EditText(this).apply {
            hint = getString(R.string.email)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        }
        val password = EditText(this).apply {
            hint = getString(R.string.password)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (20 * resources.displayMetrics.density).toInt()
            setPadding(padding, 0, padding, 0)
            addView(email, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(password, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.sign_in)
            .setView(content)
            .setPositiveButton(R.string.sign_in) { _, _ ->
                signIn(email.text.toString().trim(), password.text.toString())
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun signIn(email: String, password: String) {
        statusView.setText(R.string.map_loading)
        thread(start = true, name = "trailmark-phone-sign-in") {
            val result = SupabaseAuth.signIn(this, email, password)
            runOnUiThread {
                result.fold(
                    onSuccess = {
                        statusView.setText(R.string.signed_in)
                        loadRoutes()
                    },
                    onFailure = {
                        statusView.text = it.message ?: getString(R.string.sign_in_failed)
                    }
                )
            }
        }
    }

    private fun explainNavigationPermissions() {
        AlertDialog.Builder(this)
            .setTitle(R.string.grant_navigation_permissions)
            .setMessage(R.string.location_permission_explanation)
            .setPositiveButton(android.R.string.ok) { _, _ -> requestNextPermission() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun requestNextPermission() {
        when {
            !hasForegroundLocation() -> requestForegroundLocation()
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED ->
                requestNotificationPermission()
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED ->
                requestBackgroundLocation()
        }
    }

    private fun requestForegroundLocation() {
        requestPermissions(
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
            REQUEST_FOREGROUND_LOCATION
        )
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
    }

    private fun requestBackgroundLocation() {
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
            requestPermissions(
                arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
                REQUEST_BACKGROUND_LOCATION
            )
        } else {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            })
        }
    }

    private fun hasForegroundLocation(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun startLocationIfAllowed() {
        if (!hasForegroundLocation() || locationStarted) return
        try {
            locationService.start()
            locationStarted = true
        } catch (_: SecurityException) {
            locationStarted = false
        }
    }

    companion object {
        private const val REQUEST_FOREGROUND_LOCATION = 1001
        private const val REQUEST_BACKGROUND_LOCATION = 1002
        private const val REQUEST_NOTIFICATIONS = 1003
        private const val METERS_PER_MILE = 1609.344
        private const val MPS_TO_MPH = 2.236936
        private const val METERS_TO_FEET = 3.28084
    }
}
