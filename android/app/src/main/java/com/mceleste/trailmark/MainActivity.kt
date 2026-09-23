package com.mceleste.trailmark

import android.app.Activity
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var permissionStatus: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val email = EditText(this).apply { hint = getString(R.string.email) }
        val password = EditText(this).apply { hint = getString(R.string.password); inputType = 0x81 }
        val status = TextView(this)
        val button = Button(this).apply { text = getString(R.string.sign_in) }
        val permissionButton = Button(this).apply { text = getString(R.string.grant_navigation_permissions) }
        permissionStatus = TextView(this)

        permissionButton.setOnClickListener { requestNextPermission() }

        button.setOnClickListener {
            Thread {
                val result = SupabaseAuth.signIn(this, email.text.toString().trim(), password.text.toString())
                runOnUiThread {
                    status.text = result.fold(
                        onSuccess = { "Signed in. Connect Android Auto to use Trailmark navigation." },
                        onFailure = { it.message ?: "Sign-in failed." }
                    )
                }
            }.start()
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 64, 32, 32)
            addView(permissionButton)
            addView(permissionStatus)
            addView(email)
            addView(password)
            addView(button)
            addView(status)
        })

        updatePermissionStatus()
        if (!hasForegroundLocation()) requestForegroundLocation()
    }

    override fun onResume() {
        super.onResume()
        if (::permissionStatus.isInitialized) updatePermissionStatus()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        updatePermissionStatus()
        if (requestCode == REQUEST_FOREGROUND_LOCATION && hasForegroundLocation()) {
            requestNotificationPermission()
        }
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
            return
        }

        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
        })
    }

    private fun hasForegroundLocation(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun updatePermissionStatus() {
        val location = getString(
            if (hasForegroundLocation()) R.string.location_ready else R.string.location_permission_needed
        )
        val background = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        ) getString(R.string.background_location_ready) else getString(R.string.background_location_needed)
        val notifications = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) getString(R.string.notifications_ready) else getString(R.string.notification_permission_needed)
        permissionStatus.text = getString(R.string.permission_status, location, background, notifications)
    }

    companion object {
        private const val REQUEST_FOREGROUND_LOCATION = 1001
        private const val REQUEST_BACKGROUND_LOCATION = 1002
        private const val REQUEST_NOTIFICATIONS = 1003
    }
}
