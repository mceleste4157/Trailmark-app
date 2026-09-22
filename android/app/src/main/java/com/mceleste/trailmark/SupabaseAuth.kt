package com.mceleste.trailmark

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

object SupabaseAuth {
    private const val BASE_URL = "https://nvbtwgigniodfumjukdo.supabase.co"
    private const val PUBLISHABLE_KEY = "sb_publishable_6F7NiQxUXnMJXNCh8YL7kA_R97zntAB"
    private const val PREFS = "trailmark_auth"
    private const val TOKEN = "access_token"

    fun token(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TOKEN, null)

    fun signIn(context: Context, email: String, password: String): Result<Unit> = runCatching {
        val connection = (URL("$BASE_URL/auth/v1/token?grant_type=password").openConnection() as HttpURLConnection)
        connection.requestMethod = "POST"
        connection.setRequestProperty("apikey", PUBLISHABLE_KEY)
        connection.setRequestProperty("Content-Type", "application/json")
        connection.doOutput = true
        connection.outputStream.use {
            it.write(JSONObject().put("email", email).put("password", password).toString().toByteArray(StandardCharsets.UTF_8))
        }
        val body = connection.inputStream.bufferedReader().use { it.readText() }
        val accessToken = JSONObject(body).getString("access_token")
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(TOKEN, accessToken).apply()
    }
}
