import Foundation
import CoreLocation

struct TrailmarkPoint: Codable, Equatable {
    let latitude: Double
    let longitude: Double
    let altitudeM: Double?
    let timestampMs: Int64?
}

struct TrailmarkRoute: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let kind: String
    let points: [TrailmarkPoint]
    let distanceMeters: Double
}

struct TrailmarkFix: Equatable {
    let latitude: Double
    let longitude: Double
    let speedMps: Double?
    let bearingDeg: Double?
    let altitudeM: Double?
    let timestampMs: Int64
    let horizontalAccuracyM: Double?
}

enum NavigationStatus: String {
    case idle, navigating, arrived, offRoute = "off_route"
}

struct NavigationState {
    var status: NavigationStatus = .idle
    var routeId: String?
    var distanceRemainingMeters: Double?
    var distanceTraveledMeters: Double?
    var progress: Double?
    var nextPointIndex: Int?
    var distanceToNextPointMeters: Double?
    var currentFix: TrailmarkFix?
}
