package com.mceleste.trailmark

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleOpacity
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.iconAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.iconImage
import org.maplibre.android.style.layers.PropertyFactory.iconRotate
import org.maplibre.android.style.layers.PropertyFactory.iconSize
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

object TrailmarkMapStyle {
    const val STYLE_URI = "https://tiles.openfreemap.org/styles/liberty"

    private const val ROUTE_SOURCE = "trailmark-route-source"
    private const val LOCATION_SOURCE = "trailmark-location-source"
    private const val ROUTE_CASING_LAYER = "trailmark-route-casing"
    private const val ROUTE_LAYER = "trailmark-route"
    private const val LOCATION_HALO_LAYER = "trailmark-location-halo"
    private const val LOCATION_LAYER = "trailmark-location"
    private const val LOCATION_ARROW_LAYER = "trailmark-location-arrow-layer"
    private const val LOCATION_ARROW_IMAGE = "trailmark-location-arrow"

    fun builder(route: TrailmarkRoute?, fix: TrailmarkFix?, satellite: Boolean = false): Style.Builder {
        val builder = Style.Builder()
        if (satellite) builder.fromJson(SATELLITE_STYLE_JSON) else builder.fromUri(STYLE_URI)
        return builder
            .withSources(
                GeoJsonSource(ROUTE_SOURCE, routeGeometry(route)),
                GeoJsonSource(LOCATION_SOURCE, locationFeature(fix))
            )
            .withImage(LOCATION_ARROW_IMAGE, locationArrow(), true)
            .withLayers(
                LineLayer(ROUTE_CASING_LAYER, ROUTE_SOURCE).withProperties(
                    lineColor(Color.WHITE),
                    lineWidth(10f),
                    lineOpacity(0.92f)
                ),
                LineLayer(ROUTE_LAYER, ROUTE_SOURCE).withProperties(
                    lineColor(Color.rgb(220, 55, 45)),
                    lineWidth(6f),
                    lineOpacity(1f)
                ),
                CircleLayer(LOCATION_HALO_LAYER, LOCATION_SOURCE).withProperties(
                    circleRadius(14f),
                    circleColor(Color.WHITE),
                    circleOpacity(0.92f)
                ),
                CircleLayer(LOCATION_LAYER, LOCATION_SOURCE).withProperties(
                    circleRadius(9f),
                    circleColor(Color.rgb(32, 105, 215)),
                    circleStrokeColor(Color.WHITE),
                    circleStrokeWidth(2f)
                ),
                SymbolLayer(LOCATION_ARROW_LAYER, LOCATION_SOURCE).withProperties(
                    iconImage(LOCATION_ARROW_IMAGE),
                    iconSize(0.72f),
                    iconRotate(Expression.get("bearing")),
                    iconAllowOverlap(true)
                )
            )
    }

    fun updateRoute(style: Style, route: TrailmarkRoute?) {
        style.getSourceAs<GeoJsonSource>(ROUTE_SOURCE)?.setGeoJson(routeGeometry(route))
    }

    fun updateLocation(style: Style, fix: TrailmarkFix?) {
        style.getSourceAs<GeoJsonSource>(LOCATION_SOURCE)?.setGeoJson(locationFeature(fix))
    }

    fun bounds(route: TrailmarkRoute): LatLngBounds {
        val points = route.points.map { LatLng(it.latitude, it.longitude) }
        val raw = LatLngBounds.Builder().includes(points).build()
        val latitudePadding = ((raw.latitudeSpan * 0.12).coerceAtLeast(0.005))
        val longitudePadding = ((raw.longitudeSpan * 0.12).coerceAtLeast(0.005))
        return LatLngBounds.from(
            (raw.latitudeNorth + latitudePadding).coerceAtMost(90.0),
            (raw.longitudeEast + longitudePadding).coerceAtMost(180.0),
            (raw.latitudeSouth - latitudePadding).coerceAtLeast(-90.0),
            (raw.longitudeWest - longitudePadding).coerceAtLeast(-180.0)
        )
    }

    private fun routeGeometry(route: TrailmarkRoute?): FeatureCollection {
        val points = route?.points.orEmpty()
        if (points.size < 2) return FeatureCollection.fromFeatures(arrayOf<Feature>())
        val line = LineString.fromLngLats(points.map { Point.fromLngLat(it.longitude, it.latitude) })
        return FeatureCollection.fromFeature(Feature.fromGeometry(line))
    }

    private fun locationFeature(fix: TrailmarkFix?): FeatureCollection {
        if (fix == null) return FeatureCollection.fromFeatures(arrayOf<Feature>())
        val feature = Feature.fromGeometry(Point.fromLngLat(fix.longitude, fix.latitude))
        feature.addNumberProperty("bearing", fix.bearingDeg ?: 0.0)
        return FeatureCollection.fromFeature(feature)
    }

    private fun locationArrow(): Bitmap {
        val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        val path = Path().apply {
            moveTo(32f, 4f)
            lineTo(45f, 31f)
            lineTo(32f, 25f)
            lineTo(19f, 31f)
            close()
        }
        Canvas(bitmap).drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
        return bitmap
    }

    private const val SATELLITE_STYLE_JSON = """
        {
          "version": 8,
          "sources": {
            "esri-satellite": {
              "type": "raster",
              "tiles": ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
              "tileSize": 256,
              "maxzoom": 19,
              "attribution": "Esri, Maxar, Earthstar Geographics, and the GIS User Community"
            }
          },
          "layers": [
            { "id": "esri-satellite", "type": "raster", "source": "esri-satellite" }
          ]
        }
    """
}
