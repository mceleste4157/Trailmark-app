package com.mceleste.trailmark

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class TrailmarkCarAppService : CarAppService() {
    override fun createHostValidator(): HostValidator = if (BuildConfig.DEBUG) {
        HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    } else {
        HostValidator.Builder(this)
            .addAllowedHosts(R.array.hosts_allowlist)
            .build()
    }

    override fun onCreateSession(): Session = TrailmarkSession()
}
