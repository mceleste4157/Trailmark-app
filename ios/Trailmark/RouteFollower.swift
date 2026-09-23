import Foundation
import CoreLocation

final class RouteFollower: ObservableObject {
    @Published private(set) var state = NavigationState()
    private var route: TrailmarkRoute?

    private let offRouteThresholdM = 75.0
    private let arrivalThresholdM = 30.0

    func start(route: TrailmarkRoute) {
        self.route = route
        state = NavigationState(
            status: .navigating,
            routeId: route.id,
            distanceRemainingMeters: route.distanceMeters,
            distanceTraveledMeters: 0,
            progress: 0,
            nextPointIndex: min(1, max(0, route.points.count - 1)),
            distanceToNextPointMeters: nil,
            nextManeuver: nextManeuver(from: 0, route: route),
            currentFix: nil
        )
    }

    func stop() {
        route = nil
        state = NavigationState()
    }

    func update(fix: TrailmarkFix) {
        guard let route, route.points.count >= 2 else { return }
        state.currentFix = fix

        var bestIndex = 0
        var bestDistance = Double.greatestFiniteMagnitude
        for i in 0..<route.points.count {
            let p = CLLocation(latitude: route.points[i].latitude, longitude: route.points[i].longitude)
            let d = p.distance(from: CLLocation(latitude: fix.latitude, longitude: fix.longitude))
            if d < bestDistance {
                bestDistance = d
                bestIndex = i
            }
        }

        let remaining = distance(from: bestIndex, to: route.points.count - 1, route: route)
        let total = max(route.distanceMeters, 1)
        let traveled = max(0, total - remaining)
        let progress = min(1, max(0, traveled / total))

        state.nextPointIndex = min(bestIndex + 1, route.points.count - 1)
        state.distanceToNextPointMeters = CLLocation(
            latitude: fix.latitude, longitude: fix.longitude
        ).distance(from: CLLocation(
            latitude: route.points[state.nextPointIndex!].latitude,
            longitude: route.points[state.nextPointIndex!].longitude
        ))
        state.nextManeuver = nextManeuver(from: bestIndex, route: route)
        state.distanceRemainingMeters = remaining
        state.distanceTraveledMeters = traveled
        state.progress = progress

        if remaining <= arrivalThresholdM {
            state.status = .arrived
        } else if bestDistance > offRouteThresholdM {
            state.status = .offRoute
        } else {
            state.status = .navigating
        }
    }

    private func distance(from start: Int, to end: Int, route: TrailmarkRoute) -> Double {
        guard start < end else { return 0 }
        var total = 0.0
        for i in start..<end {
            let a = CLLocation(latitude: route.points[i].latitude, longitude: route.points[i].longitude)
            let b = CLLocation(latitude: route.points[i + 1].latitude, longitude: route.points[i + 1].longitude)
            total += a.distance(from: b)
        }
        return total
    }

    private func nextManeuver(from index: Int, route: TrailmarkRoute) -> TrailmarkManeuver? {
        guard route.points.count >= 3 else { return nil }
        let start = max(1, index + 1)
        guard start < route.points.count - 1 else {
            return TrailmarkManeuver(
                pointIndex: route.points.count - 1,
                direction: .straight,
                instruction: "Continue to the end of the trail",
                distanceMeters: distance(from: index, to: route.points.count - 1, route: route),
                turnDegrees: 0
            )
        }

        for i in start..<(route.points.count - 1) {
            let incoming = bearing(from: route.points[i - 1], to: route.points[i])
            let outgoing = bearing(from: route.points[i], to: route.points[i + 1])
            let turn = normalizeTurn(outgoing - incoming)
            let magnitude = abs(turn)
            if magnitude >= Self.turnThresholdDegrees {
                let direction: ManeuverDirection
                if turn <= -Self.sharpTurnThresholdDegrees {
                    direction = .sharpLeft
                } else if turn < 0 {
                    direction = .left
                } else if turn >= Self.sharpTurnThresholdDegrees {
                    direction = .sharpRight
                } else {
                    direction = .right
                }

                return TrailmarkManeuver(
                    pointIndex: i,
                    direction: direction,
                    instruction: instruction(for: direction),
                    distanceMeters: distance(from: index, to: i, route: route),
                    turnDegrees: turn
                )
            }
        }

        return TrailmarkManeuver(
            pointIndex: route.points.count - 1,
            direction: .straight,
            instruction: "Continue to the end of the trail",
            distanceMeters: distance(from: index, to: route.points.count - 1, route: route),
            turnDegrees: 0
        )
    }

    private func instruction(for direction: ManeuverDirection) -> String {
        switch direction {
        case .sharpLeft:
            return "Sharp left ahead"
        case .left:
            return "Turn left ahead"
        case .right:
            return "Turn right ahead"
        case .sharpRight:
            return "Sharp right ahead"
        case .straight:
            return "Continue on trail"
        }
    }

    private func bearing(from a: TrailmarkPoint, to b: TrailmarkPoint) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let deltaLon = (b.longitude - a.longitude) * .pi / 180
        let y = sin(deltaLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLon)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }

    private func normalizeTurn(_ turn: Double) -> Double {
        var normalized = turn
        while normalized > 180 { normalized -= 360 }
        while normalized < -180 { normalized += 360 }
        return normalized
    }

    private static let turnThresholdDegrees = 35.0
    private static let sharpTurnThresholdDegrees = 100.0
}
