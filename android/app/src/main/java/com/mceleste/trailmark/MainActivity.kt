package com.mceleste.trailmark

import android.app.Activity
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 1001)
        }

        val email = EditText(this).apply { hint = "Email" }
        val password = EditText(this).apply { hint = "Password"; inputType = 0x81 }
        val status = TextView(this)
        val button = Button(this).apply { text = "Sign In" }

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
            addView(email)
            addView(password)
            addView(button)
            addView(status)
        })
    }
}
