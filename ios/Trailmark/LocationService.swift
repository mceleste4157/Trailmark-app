import Foundation
import CoreLocation

final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    @Published private(set) var lastFix: TrailmarkFix?
    @Published private(set) var authorization: CLAuthorizationStatus = .notDetermined

    private let manager = CLLocationManager()

    override private init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 3
        authorization = manager.authorizationStatus
    }

    var authorizationText: String {
        switch authorization {
        case .authorizedAlways: return "Location: Always"
        case .authorizedWhenInUse: return "Location: While Using"
        case .denied: return "Location permission denied"
        case .restricted: return "Location restricted"
        default: return "Location permission not granted"
        }
    }

    func requestAuthorization() {
        manager.requestAlwaysAuthorization()
    }

    func start() {
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        if authorization == .authorizedAlways || authorization == .authorizedWhenInUse {
            start()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        lastFix = TrailmarkFix(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            speedMps: location.speed >= 0 ? location.speed : nil,
            bearingDeg: location.course >= 0 ? location.course : nil,
            altitudeM: location.altitude,
            timestampMs: Int64(location.timestamp.timeIntervalSince1970 * 1000),
            horizontalAccuracyM: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        )
    }
}
