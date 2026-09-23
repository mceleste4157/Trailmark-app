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
    private lateinit var groupRepository: GroupRepository

    private var map: MapLibreMap? = null
    private var routes: List<TrailmarkRoute> = emptyList()
    private var activeRoute: TrailmarkRoute? = null
    private var latestFix: TrailmarkFix? = null
    private var locationStarted = false
    private var satelliteMode = false
    private var routeLayerVisible = true
    private var lightChrome = false

    // Crew groups + community trails — see GroupRepository and
    // sql/schema.sql's "Crew groups"/global_trails sections. currentGroup
    // is refreshed on launch (if already signed in), after joining/
    // creating/leaving a group, and drives whether onLocationFix
    // broadcasts this device's position to the crew.
    private var currentGroup: TrailmarkGroup? = null
    private var crewLocations: List<CrewLocation> = emptyList()
    private var communityTrails: List<GlobalTrail> = emptyList()
    private var communityTrailsOn = false
    private var lastCrewBroadcastAt = 0L

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
        groupRepository = GroupRepository(this)
        locationService = LocationService(this, ::onLocationFix)

        mapView.onCreate(savedInstanceState)
        mapView.getMapAsync { readyMap ->
            map = readyMap
            readyMap.setStyle(
                TrailmarkMapStyle.builder(
                    if (routeLayerVisible) activeRoute else null,
                    latestFix,
                    satelliteMode,
                    communityTrails,
                    crewLocations,
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
        findViewById<View>(R.id.chat_button).setOnClickListener { showCrewMenu() }
        findViewById<View>(R.id.account_button).setOnClickListener { showSetupMenu() }
        findViewById<View>(R.id.basemap_button).setOnClickListener { toggleBasemap() }
        findViewById<View>(R.id.layers_button).setOnClickListener { showLayersMenu() }
        findViewById<View>(R.id.weather_button).setOnClickListener { openWeather() }
        findViewById<View>(R.id.theme_button).setOnClickListener { toggleChromeTheme() }

        loadRoutes()
        if (SupabaseAuth.token(this) != null) refreshMyGroup()
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
        broadcastLocationToCrew(fix)
    }

    // Presence for the crew group (see GroupRepository.updateMyLocation) —
    // a no-op unless signed in and currently in a group. Throttled the
    // same way the web app's browser geolocation watch throttles its own
    // upserts, so a GPS fix every second or two doesn't turn into a
    // network call every second or two.
    private fun broadcastLocationToCrew(fix: TrailmarkFix) {
        val group = currentGroup ?: return
        val now = System.currentTimeMillis()
        if (now - lastCrewBroadcastAt < 15_000) return
        lastCrewBroadcastAt = now
        thread(start = true, name = "trailmark-crew-broadcast") {
            groupRepository.updateMyLocation(fix.latitude, fix.longitude, group.id)
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
                if (communityTrailsOn) communityTrails else emptyList(),
                crewLocations,
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

    private fun showLayersMenu() {
        // Unlike the web app, Android's Supabase URL/key are hardcoded in
        // SupabaseAuth (no separate "not configured" state), so community
        // trails is always offered here.
        val labels = mutableListOf(getString(R.string.route_line), getString(R.string.community_trails))
        val checked = mutableListOf(routeLayerVisible, communityTrailsOn)
        AlertDialog.Builder(this)
            .setTitle(R.string.layers)
            .setMultiChoiceItems(labels.toTypedArray(), checked.toBooleanArray()) { _, index, isChecked ->
                when (index) {
                    0 -> {
                        if (isChecked != routeLayerVisible) toggleRouteLayer()
                    }
                    1 -> {
                        if (isChecked != communityTrailsOn) toggleCommunityTrails()
                    }
                }
            }
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun toggleCommunityTrails() {
        communityTrailsOn = !communityTrailsOn
        if (!communityTrailsOn) {
            map?.style?.let { TrailmarkMapStyle.updateCommunityTrails(it, emptyList()) }
            return
        }
        if (communityTrails.isNotEmpty()) {
            map?.style?.let { TrailmarkMapStyle.updateCommunityTrails(it, communityTrails) }
            return
        }
        thread(start = true, name = "trailmark-community-trails-loader") {
            val result = groupRepository.listGlobalTrails()
            runOnUiThread {
                result.fold(
                    onSuccess = { trails ->
                        communityTrails = trails
                        map?.style?.let { TrailmarkMapStyle.updateCommunityTrails(it, trails) }
                    },
                    onFailure = {
                        communityTrailsOn = false
                        statusView.text = it.message ?: getString(R.string.community_trails_failed)
                    }
                )
            }
        }
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
            arrayOf(getString(R.string.routes), getString(R.string.grant_navigation_permissions), getString(R.string.sign_out))
        } else {
            arrayOf(getString(R.string.sign_in), getString(R.string.grant_navigation_permissions))
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.account)
            .setItems(items) { _, index ->
                when {
                    index == 0 && !signedIn -> showSignInDialog()
                    index == 0 -> loadRoutes()
                    index == 2 -> signOut()
                    else -> explainNavigationPermissions()
                }
            }
            .show()
    }

    private fun signOut() {
        SupabaseAuth.signOut(this)
        currentGroup = null
        crewLocations = emptyList()
        map?.style?.let { TrailmarkMapStyle.updateCrew(it, emptyList()) }
        statusView.setText(R.string.signed_out)
        loadRoutes()
    }

    // ---------- Crew groups (see GroupRepository + sql/schema.sql's
    // "Crew groups" section) — reachable from the bottom bar's Chat
    // button, since there's no dedicated messaging UI on the phone app
    // yet (see docs/MOBILE_ARCHITECTURE.md's "phone-only" precedent for
    // why that's deliberately not exposed on the CarPlay/Android Auto
    // vehicle surface either way). This is presence + shared trails/
    // routes only — "so you can see each other" — not chat.
    private fun showCrewMenu() {
        if (SupabaseAuth.token(this) == null) {
            AlertDialog.Builder(this)
                .setTitle(R.string.crew)
                .setMessage(R.string.crew_requires_sign_in)
                .setPositiveButton(R.string.sign_in) { _, _ -> showSignInDialog() }
                .setNegativeButton(R.string.cancel, null)
                .show()
            return
        }
        val group = currentGroup
        if (group == null) {
            showJoinOrCreateGroupDialog()
            return
        }
        val message = getString(R.string.crew_group_status, group.name, crewLocations.size)
        AlertDialog.Builder(this)
            .setTitle(R.string.crew)
            .setMessage(message)
            .setPositiveButton(R.string.refresh) { _, _ -> refreshCrewLocations() }
            .setNegativeButton(R.string.leave_group) { _, _ -> confirmLeaveGroup(group) }
            .setNeutralButton(R.string.cancel, null)
            .show()
    }

    private fun confirmLeaveGroup(group: TrailmarkGroup) {
        AlertDialog.Builder(this)
            .setTitle(R.string.leave_group)
            .setMessage(getString(R.string.leave_group_confirm, group.name))
            .setPositiveButton(R.string.leave_group) { _, _ ->
                thread(start = true, name = "trailmark-leave-group") {
                    val result = groupRepository.leaveGroup()
                    runOnUiThread {
                        result.onSuccess {
                            currentGroup = null
                            crewLocations = emptyList()
                            map?.style?.let { TrailmarkMapStyle.updateCrew(it, emptyList()) }
                        }
                        result.onFailure { statusView.text = it.message ?: getString(R.string.crew_action_failed) }
                    }
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun showJoinOrCreateGroupDialog() {
        val name = EditText(this).apply { hint = getString(R.string.group_name) }
        val password = EditText(this).apply {
            hint = getString(R.string.group_password)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (20 * resources.displayMetrics.density).toInt()
            setPadding(padding, 0, padding, 0)
            addView(TextView(this@MainActivity).apply { text = getString(R.string.no_crew_group_yet) })
            addView(name, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(password, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.crew)
            .setView(content)
            .setPositiveButton(R.string.join_group) { _, _ ->
                submitGroupAction(name.text.toString().trim(), password.text.toString(), join = true)
            }
            .setNeutralButton(R.string.create_group) { _, _ ->
                submitGroupAction(name.text.toString().trim(), password.text.toString(), join = false)
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun submitGroupAction(name: String, password: String, join: Boolean) {
        if (name.isEmpty() || password.isEmpty()) {
            statusView.setText(R.string.group_name_password_required)
            return
        }
        statusView.setText(R.string.map_loading)
        thread(start = true, name = "trailmark-group-action") {
            val result = if (join) groupRepository.joinGroup(name, password) else groupRepository.createGroup(name, password)
            runOnUiThread {
                result.fold(
                    onSuccess = { group ->
                        currentGroup = group
                        statusView.text = group?.name?.let { getString(R.string.joined_group, it) } ?: ""
                        refreshCrewLocations()
                    },
                    onFailure = { statusView.text = it.message ?: getString(R.string.crew_action_failed) }
                )
            }
        }
    }

    private fun refreshMyGroup() {
        thread(start = true, name = "trailmark-my-group") {
            val result = groupRepository.myGroup()
            runOnUiThread {
                result.onSuccess { group ->
                    currentGroup = group
                    if (group != null) refreshCrewLocations()
                }
            }
        }
    }

    private fun refreshCrewLocations() {
        val group = currentGroup ?: return
        thread(start = true, name = "trailmark-crew-locations") {
            val result = groupRepository.listCrewLocations()
            runOnUiThread {
                result.onSuccess { rows ->
                    if (currentGroup?.id != group.id) return@onSuccess // group changed/left mid-request
                    crewLocations = rows
                    map?.style?.let { TrailmarkMapStyle.updateCrew(it, rows) }
                }
            }
        }
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
