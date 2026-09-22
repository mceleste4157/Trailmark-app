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
}
