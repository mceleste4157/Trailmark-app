package com.mceleste.trailmark

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

object SupabaseAuth {
    const val BASE_URL = "https://nvbtwgigniodfumjukdo.supabase.co"
    const val PUBLISHABLE_KEY = "sb_publishable_6F7NiQxUXnMJXNCh8YL7kA_R97zntAB"
    private const val PREFS = "trailmark_auth"
    private const val TOKEN = "access_token"
    private const val USER_ID = "user_id"

    fun token(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TOKEN, null)

    fun userId(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(USER_ID, null)

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
        val json = JSONObject(body)
        val accessToken = json.getString("access_token")
        val uid = json.getJSONObject("user").getString("id")
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(TOKEN, accessToken)
            .putString(USER_ID, uid)
            .apply()
    }

    fun signOut(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
