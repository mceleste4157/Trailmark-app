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

enum ManeuverDirection: String, Codable, Equatable {
    case straight
    case left
    case right
    case sharpLeft = "sharp_left"
    case sharpRight = "sharp_right"
}

struct TrailmarkManeuver: Codable, Equatable {
    let pointIndex: Int
    let direction: ManeuverDirection
    let instruction: String
    let distanceMeters: Double
    let turnDegrees: Double
}

struct NavigationState {
    var status: NavigationStatus = .idle
    var routeId: String?
    var distanceRemainingMeters: Double?
    var distanceTraveledMeters: Double?
    var progress: Double?
    var nextPointIndex: Int?
    var distanceToNextPointMeters: Double?
    var nextManeuver: TrailmarkManeuver?
    var currentFix: TrailmarkFix?
}
