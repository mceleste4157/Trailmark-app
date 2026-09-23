package com.mceleste.trailmark

import android.content.Context
import org.json.JSONObject
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition

class OfflineMapManager(context: Context) {
    private val manager = OfflineManager.getInstance(context.applicationContext)

    fun downloadRoute(
        route: TrailmarkRoute,
        onProgress: (Int) -> Unit,
        onComplete: () -> Unit,
        onError: (String) -> Unit
    ) {
        manager.listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
            override fun onList(offlineRegions: Array<OfflineRegion>?) {
                val existing = offlineRegions.orEmpty().firstOrNull { region ->
                    runCatching {
                        JSONObject(region.metadata.toString(Charsets.UTF_8)).optString("routeId") == route.id
                    }.getOrDefault(false)
                }
                if (existing == null) {
                    createRegion(route, onProgress, onComplete, onError)
                } else {
                    resumeRegion(existing, onProgress, onComplete, onError)
                }
            }

            override fun onError(error: String) = onError(error)
        })
    }

    private fun createRegion(
        route: TrailmarkRoute,
        onProgress: (Int) -> Unit,
        onComplete: () -> Unit,
        onError: (String) -> Unit
    ) {
        val definition = OfflineTilePyramidRegionDefinition(
            TrailmarkMapStyle.STYLE_URI,
            TrailmarkMapStyle.bounds(route),
            MIN_ZOOM,
            MAX_ZOOM,
            1f
        )
        val metadata = JSONObject()
            .put("routeId", route.id)
            .put("name", route.name)
            .toString()
            .toByteArray(Charsets.UTF_8)

        manager.createOfflineRegion(
            definition,
            metadata,
            object : OfflineManager.CreateOfflineRegionCallback {
                override fun onCreate(offlineRegion: OfflineRegion) {
                    observeDownload(offlineRegion, onProgress, onComplete, onError)
                    offlineRegion.setDownloadState(OfflineRegion.STATE_ACTIVE)
                }

                override fun onError(error: String) = onError(error)
            }
        )
    }

    private fun resumeRegion(
        region: OfflineRegion,
        onProgress: (Int) -> Unit,
        onComplete: () -> Unit,
        onError: (String) -> Unit
    ) {
        region.getStatus(object : OfflineRegion.OfflineRegionStatusCallback {
            override fun onStatus(status: OfflineRegionStatus?) {
                if (status == null) {
                    onError("Offline region status is unavailable")
                } else if (status.isComplete) {
                    onProgress(100)
                    onComplete()
                } else {
                    observeDownload(region, onProgress, onComplete, onError)
                    region.setDownloadState(OfflineRegion.STATE_ACTIVE)
                }
            }

            override fun onError(error: String?) =
                onError(error ?: "Unable to read offline region status")
        })
    }

    private fun observeDownload(
        region: OfflineRegion,
        onProgress: (Int) -> Unit,
        onComplete: () -> Unit,
        onError: (String) -> Unit
    ) {
        region.setObserver(object : OfflineRegion.OfflineRegionObserver {
            override fun onStatusChanged(status: OfflineRegionStatus) {
                val required = status.requiredResourceCount
                val percent = if (required > 0) {
                    ((status.completedResourceCount * 100) / required).toInt().coerceIn(0, 100)
                } else {
                    0
                }
                onProgress(percent)
                if (status.isComplete) {
                    region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                    onComplete()
                }
            }

            override fun onError(error: OfflineRegionError) {
                region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                onError(error.message)
            }

            override fun mapboxTileCountLimitExceeded(limit: Long) {
                region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                onError("Offline tile limit exceeded ($limit tiles)")
            }
        })
    }

    companion object {
        private const val MIN_ZOOM = 8.0
        private const val MAX_ZOOM = 16.0
    }
}
