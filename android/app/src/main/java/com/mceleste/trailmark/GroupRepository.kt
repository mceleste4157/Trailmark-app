package com.mceleste.trailmark

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

// Crew groups (join/create with a name+password so your crew sees each
// other) and the anonymous, app-wide community trails layer — the native
// counterpart of js/group/backend.js's getMyGroup/createGroup/joinGroup/
// leaveGroup/contributeGlobalTrail/listGlobalTrails. See sql/schema.sql
// for the RPC functions and RLS this talks to: create_group/join_group/
// leave_group/my_group are SECURITY DEFINER functions, so the password
// itself is never readable from the client, only checked server-side.
class GroupRepository(private val context: Context) {
    companion object {
        private const val BASE_URL = SupabaseAuth.BASE_URL
        private const val PUBLISHABLE_KEY = SupabaseAuth.PUBLISHABLE_KEY
    }

    private fun rpc(name: String, body: JSONObject): Result<JSONArray> = runCatching {
        val token = SupabaseAuth.token(context) ?: throw IllegalStateException("Not signed in")
        val connection = (URL("$BASE_URL/rest/v1/rpc/$name").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("apikey", PUBLISHABLE_KEY)
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json")
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 20_000
        }
        connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
        val code = connection.responseCode
        if (code !in 200..299) {
            val errorBody = connection.errorStream?.bufferedReader()?.use { it.readText() }
            val message = errorBody?.let { runCatching { JSONObject(it).optString("message") }.getOrNull() }
            throw RuntimeException(message?.takeIf { it.isNotBlank() } ?: "Request failed ($code)")
        }
        JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
    }

    private fun groupFromRow(rows: JSONArray): TrailmarkGroup? {
        if (rows.length() == 0) return null
        val row = rows.getJSONObject(0)
        val id = row.optString("group_id", "")
        if (id.isEmpty()) return null
        return TrailmarkGroup(id = id, name = row.optString("group_name", ""))
    }

    fun myGroup(): Result<TrailmarkGroup?> = rpc("my_group", JSONObject()).map(::groupFromRow)

    fun createGroup(name: String, password: String): Result<TrailmarkGroup?> =
        rpc("create_group", JSONObject().put("p_name", name).put("p_password", password)).map(::groupFromRow)

    fun joinGroup(name: String, password: String): Result<TrailmarkGroup?> =
        rpc("join_group", JSONObject().put("p_name", name).put("p_password", password)).map(::groupFromRow)

    fun leaveGroup(): Result<Unit> = rpc("leave_group", JSONObject()).map {}

    // ---------- Live crew locations ----------
    fun updateMyLocation(latitude: Double, longitude: Double, groupId: String?): Result<Unit> = runCatching {
        val token = SupabaseAuth.token(context) ?: throw IllegalStateException("Not signed in")
        val uid = SupabaseAuth.userId(context) ?: throw IllegalStateException("Not signed in")
        val connection = (URL("$BASE_URL/rest/v1/locations").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("apikey", PUBLISHABLE_KEY)
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json")
            // Upserts on the primary key (user_id) instead of erroring on
            // conflict — same "one row per user" presence model the web
            // app's updateMyLocation() upsert relies on.
            setRequestProperty("Prefer", "resolution=merge-duplicates")
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 20_000
        }
        val body = JSONObject()
            .put("user_id", uid)
            .put("lat", latitude)
            .put("lng", longitude)
            .put("group_id", groupId)
        connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
        if (connection.responseCode !in 200..299) throw RuntimeException("Location update failed (${connection.responseCode})")
        connection.inputStream.close()
    }

    fun listCrewLocations(): Result<List<CrewLocation>> = runCatching {
        val token = SupabaseAuth.token(context) ?: throw IllegalStateException("Not signed in")
        val myUid = SupabaseAuth.userId(context)
        val url = URL("$BASE_URL/rest/v1/locations?select=user_id,lat,lng,profiles(display_name)")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            setRequestProperty("apikey", PUBLISHABLE_KEY)
            setRequestProperty("Authorization", "Bearer $token")
            connectTimeout = 15_000
            readTimeout = 20_000
        }
        connection.connect()
        if (connection.responseCode !in 200..299) throw RuntimeException("Could not load crew locations (${connection.responseCode})")
        val rows = JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
        buildList {
            for (i in 0 until rows.length()) {
                val row = rows.getJSONObject(i)
                val userId = row.getString("user_id")
                if (userId == myUid) continue // don't show yourself, same as the web app
                val name = row.optJSONObject("profiles")?.optString("display_name", "Rider") ?: "Rider"
                add(CrewLocation(userId = userId, displayName = name, latitude = row.getDouble("lat"), longitude = row.getDouble("lng")))
            }
        }
    }

    // ---------- Community trails (anonymous, app-wide — readable
    // without being signed in, per sql/schema.sql's RLS) ----------
    fun listGlobalTrails(): Result<List<GlobalTrail>> = runCatching {
        val url = URL("$BASE_URL/rest/v1/global_trails?select=id,points")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            setRequestProperty("apikey", PUBLISHABLE_KEY)
            SupabaseAuth.token(context)?.let { setRequestProperty("Authorization", "Bearer $it") }
            connectTimeout = 15_000
            readTimeout = 20_000
        }
        connection.connect()
        if (connection.responseCode !in 200..299) throw RuntimeException("Could not load community trails (${connection.responseCode})")
        val rows = JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
        buildList {
            for (i in 0 until rows.length()) {
                val row = rows.getJSONObject(i)
                val pointsJson = row.getJSONArray("points")
                val points = buildList {
                    for (j in 0 until pointsJson.length()) {
                        val p = pointsJson.getJSONObject(j)
                        add(TrailmarkPoint(latitude = p.getDouble("lat"), longitude = p.getDouble("lng")))
                    }
                }
                if (points.size >= 2) add(GlobalTrail(id = row.getString("id"), points = points))
            }
        }
    }
}
