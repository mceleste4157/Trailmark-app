package com.mceleste.trailmark

import androidx.car.app.CarAppService
import androidx.car.app.HostValidator
import androidx.car.app.Session

class TrailmarkCarAppService : CarAppService() {
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = TrailmarkSession()
}
