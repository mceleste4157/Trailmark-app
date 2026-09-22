package com.mceleste.trailmark

import android.content.Context
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

class RouteRepository(private val context: Context) {
    companion object {
        private const val BASE_URL = "https://nvbtwgigniodfumjukdo.supabase.co"
        private const val PUBLISHABLE_KEY = "sb_publishable_6F7NiQxUXnMJXNCh8YL7kA_R97zntAB"
    }

    fun fetchRoutes(): List<TrailmarkRoute> {
        val token = SupabaseAuth.token(context) ?: return emptyList()
        val url = URL("$BASE_URL/rest/v1/shared_trails?select=id,name,points,distance_meters&order=created_at.desc&limit=100")
        val connection = (url.openConnection() as HttpURLConnection)
        connection.setRequestProperty("apikey", PUBLISHABLE_KEY)
        connection.setRequestProperty("Authorization", "Bearer $token")
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
                        add(TrailmarkPoint(p.getDouble("lat"), p.getDouble("lng")))
                    }
                }
                if (points.size >= 2) {
                    add(TrailmarkRoute(
                        id = row.getString("id"),
                        name = row.getString("name"),
                        points = points,
                        distanceMeters = row.optDouble("distance_meters", 0.0)
                    ))
                }
            }
        }
    }
}
