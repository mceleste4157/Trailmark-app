package com.mceleste.trailmark

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class OfflineRouteStore(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE routes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                distance_meters REAL NOT NULL,
                metadata_json TEXT,
                updated_at_ms INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE route_points (
                route_id TEXT NOT NULL,
                point_index INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                elevation_m REAL,
                timestamp_ms INTEGER,
                PRIMARY KEY (route_id, point_index),
                FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX route_points_route_id_index ON route_points(route_id)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS route_points")
        db.execSQL("DROP TABLE IF EXISTS routes")
        onCreate(db)
    }

    fun saveRoutes(routes: List<TrailmarkRoute>) {
        writableDatabase.transaction {
            routes.forEach { route ->
                val routeValues = ContentValues().apply {
                    put("id", route.id)
                    put("name", route.name)
                    put("kind", route.kind)
                    put("distance_meters", route.distanceMeters)
                    put("metadata_json", route.metadataJson)
                    put("updated_at_ms", System.currentTimeMillis())
                }
                insertWithOnConflict("routes", null, routeValues, SQLiteDatabase.CONFLICT_REPLACE)
                delete("route_points", "route_id = ?", arrayOf(route.id))

                route.points.forEachIndexed { index, point ->
                    val pointValues = ContentValues().apply {
                        put("route_id", route.id)
                        put("point_index", index)
                        put("latitude", point.latitude)
                        put("longitude", point.longitude)
                        put("elevation_m", point.elevationM)
                        put("timestamp_ms", point.timestampMs)
                    }
                    insertWithOnConflict("route_points", null, pointValues, SQLiteDatabase.CONFLICT_REPLACE)
                }
            }
        }
    }

    fun loadRoutes(): List<TrailmarkRoute> {
        val db = readableDatabase
        val routes = mutableListOf<TrailmarkRoute>()
        db.rawQuery(
            "SELECT id, name, kind, distance_meters, metadata_json FROM routes ORDER BY updated_at_ms DESC",
            emptyArray()
        ).use { routeCursor ->
            while (routeCursor.moveToNext()) {
                val id = routeCursor.getString(0)
                val points = mutableListOf<TrailmarkPoint>()
                db.rawQuery(
                    """
                    SELECT latitude, longitude, elevation_m, timestamp_ms
                    FROM route_points
                    WHERE route_id = ?
                    ORDER BY point_index ASC
                    """.trimIndent(),
                    arrayOf(id)
                ).use { pointCursor ->
                    while (pointCursor.moveToNext()) {
                        points.add(
                            TrailmarkPoint(
                                latitude = pointCursor.getDouble(0),
                                longitude = pointCursor.getDouble(1),
                                elevationM = pointCursor.optionalDouble(2),
                                timestampMs = pointCursor.optionalLong(3)
                            )
                        )
                    }
                }
                if (points.size >= 2) {
                    routes.add(
                        TrailmarkRoute(
                            id = id,
                            name = routeCursor.getString(1),
                            kind = routeCursor.getString(2),
                            distanceMeters = routeCursor.getDouble(3),
                            metadataJson = routeCursor.optionalString(4),
                            points = points
                        )
                    )
                }
            }
        }
        return routes
    }

    private inline fun SQLiteDatabase.transaction(block: SQLiteDatabase.() -> Unit) {
        beginTransaction()
        try {
            block()
            setTransactionSuccessful()
        } finally {
            endTransaction()
        }
    }

    private fun android.database.Cursor.optionalDouble(index: Int): Double? =
        if (isNull(index)) null else getDouble(index)

    private fun android.database.Cursor.optionalLong(index: Int): Long? =
        if (isNull(index)) null else getLong(index)

    private fun android.database.Cursor.optionalString(index: Int): String? =
        if (isNull(index)) null else getString(index)

    companion object {
        private const val DATABASE_NAME = "trailmark_routes.db"
        private const val DATABASE_VERSION = 1
    }
}
