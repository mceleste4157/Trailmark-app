package com.mceleste.trailmark

import android.content.Context
import android.location.Location
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class RouteRepository(private val context: Context) {
    private val offlineStore = OfflineRouteStore(context)

    companion object {
        private const val BASE_URL = "https://nvbtwgigniodfumjukdo.supabase.co"
        private const val PUBLISHABLE_KEY = "sb_publishable_6F7NiQxUXnMJXNCh8YL7kA_R97zntAB"
    }

    fun fetchRoutes(): List<TrailmarkRoute> {
        val token = SupabaseAuth.token(context) ?: return offlineStore.loadRoutes()
        return try {
            val routes = fetchRemoteRoutes(token)
            if (routes.isNotEmpty()) offlineStore.saveRoutes(routes)
            routes.ifEmpty { offlineStore.loadRoutes() }
        } catch (_: Exception) {
            offlineStore.loadRoutes()
        }
    }

    private fun fetchRemoteRoutes(token: String): List<TrailmarkRoute> {
        val url = URL("$BASE_URL/rest/v1/shared_trails?select=id,name,kind,points,distance_meters,metadata&order=created_at.desc&limit=100")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            setRequestProperty("apikey", PUBLISHABLE_KEY)
            setRequestProperty("Authorization", "Bearer $token")
            connectTimeout = 15_000
            readTimeout = 20_000
        }
        connection.connect()
        if (connection.responseCode !in 200..299) return emptyList()
        val rows = JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
        return buildList {
            for (i in 0 until rows.length()) {
                val row = rows.getJSONObject(i)
                val pointJson = row.getJSONArray("points")
                val points = buildList {
                    for (j in 0 until pointJson.length()) {
                        val p = pointJson.getJSONObject(j)
                        add(
                            TrailmarkPoint(
                                latitude = p.getDouble("lat"),
                                longitude = p.getDouble("lng"),
                                elevationM = p.optionalDouble("ele"),
                                timestampMs = p.optionalLong("t")
                            )
                        )
                    }
                }
                if (points.size >= 2) {
                    add(TrailmarkRoute(
                        id = row.getString("id"),
                        name = row.getString("name"),
                        kind = row.optString("kind", "recorded"),
                        points = points,
                        distanceMeters = row.optDouble("distance_meters", calculateDistance(points)),
                        metadataJson = row.optJSONObject("metadata")?.toString()
                    ))
                }
            }
        }
    }

    private fun calculateDistance(points: List<TrailmarkPoint>): Double {
        var total = 0.0
        val result = FloatArray(1)
        for (i in 0 until points.lastIndex) {
            val a = points[i]
            val b = points[i + 1]
            Location.distanceBetween(a.latitude, a.longitude, b.latitude, b.longitude, result)
            total += result[0]
        }
        return total
    }

    private fun JSONObject.optionalDouble(name: String): Double? =
        if (has(name) && !isNull(name)) optDouble(name) else null

    private fun JSONObject.optionalLong(name: String): Long? =
        if (has(name) && !isNull(name)) optLong(name) else null
}
