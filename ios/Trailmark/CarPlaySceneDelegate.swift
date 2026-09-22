import UIKit
import CarPlay
import MapKit

final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private var carWindow: CPWindow?
    private var mapTemplate: CPMapTemplate?
    private var navigationSession: CPNavigationSession?
    private let location = LocationService.shared
    private let follower = RouteFollower()
    private var routesById: [String: TrailmarkRoute] = [:]

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController,
        to window: CPWindow
    ) {
        self.interfaceController = interfaceController
        self.carWindow = window

        let map = CPMapTemplate()
        map.mapDelegate = self
        map.automaticallyHidesNavigationBar = false

        let routesButton = CPBarButton(title: "Routes") { [weak self] _ in
            self?.showRoutes()
        }
        let stop = CPBarButton(title: "Stop") { [weak self] _ in
            self?.stopNavigation()
        }
        map.trailingNavigationBarButtons = [routesButton, stop]

        let mapController = CarPlayMapViewController()
        window.rootViewController = mapController
        self.mapTemplate = map

        interfaceController.setRootTemplate(map, animated: true)
        location.start()
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController,
        from window: CPWindow
    ) {
        location.stop()
        self.interfaceController = nil
        self.carWindow = nil
        self.mapTemplate = nil
        self.navigationSession = nil
    }

    private func showRoutes() {
        Task {
            do {
                let routes = try await RouteRepository.shared.fetchRoutes()
                routesById = Dictionary(uniqueKeysWithValues: routes.map { ($0.id, $0) })

                let items = routes.prefix(20).map { route -> CPListItem in
                    let item = CPListItem(
                        text: route.name,
                        detailText: "\(route.points.count) points · \(String(format: "%.1f", route.distanceMeters / 1609.344)) mi"
                    )
                    item.userInfo = route.id
                    item.handler = { [weak self] _, completion in
                        self?.beginPreview(for: route)
                        completion()
                    }
                    return item
                }

                let section = CPListSection(items: items)
                let list = CPListTemplate(title: "Trailmark Routes", sections: [section])
                await MainActor.run {
                    self.interfaceController?.pushTemplate(list, animated: true)
                }
            } catch {
                let alert = CPAlertTemplate(
                    title: "Trailmark",
                    message: error.localizedDescription,
                    actions: [CPAlertAction(title: "OK", style: .default, handler: { _ in })]
                )
                await MainActor.run {
                    self.interfaceController?.presentTemplate(alert, animated: true)
                }
            }
        }
    }

    private func beginPreview(for route: TrailmarkRoute) {
        guard let mapTemplate else { return }

        let originFix = location.lastFix
        let originPoint = originFix.map {
            CPLocationCoordinate3D(latitude: $0.latitude, longitude: $0.longitude, altitude: $0.altitudeM ?? 0)
        } ?? CPLocationCoordinate3D(
            latitude: route.points[0].latitude,
            longitude: route.points[0].longitude,
            altitude: route.points[0].altitudeM ?? 0
        )
        let destinationPoint = CPLocationCoordinate3D(
            latitude: route.points.last!.latitude,
            longitude: route.points.last!.longitude,
            altitude: route.points.last!.altitudeM ?? 0
        )

        let origin = CPNavigationWaypoint(
            centerPoint: originPoint,
            locationThreshold: Measurement(value: 30, unit: .meters),
            name: "Current location",
            address: nil,
            entryPoints: [],
            timeZone: nil
        )
        let destination = CPNavigationWaypoint(
            centerPoint: destinationPoint,
            locationThreshold: Measurement(value: 30, unit: .meters),
            name: route.name,
            address: nil,
            entryPoints: [],
            timeZone: nil
        )

        let choice = CPRouteChoice(
            summaryVariants: [route.name],
            additionalInformationVariants: ["Trailmark route"],
            selectionSummaryVariants: ["Start \(route.name)"]
        )
        let trip = CPTrip(originWaypoint: origin, destinationWaypoint: destination, routeChoices: [choice])
        trip.userInfo = route.id

        mapTemplate.showTripPreviews([trip], textConfiguration: nil)
    }

    private func stopNavigation() {
        navigationSession?.cancelTrip()
        navigationSession = nil
        follower.stop()
    }

    private func finishNavigation() {
        navigationSession?.finishTrip()
        navigationSession = nil
        follower.stop()
    }
}

extension CarPlaySceneDelegate: CPMapTemplateDelegate {
    func mapTemplate(
        _ mapTemplate: CPMapTemplate,
        startedTrip trip: CPTrip,
        using routeChoice: CPRouteChoice
    ) {
        guard let routeId = trip.userInfo as? String, let route = routesById[routeId] else { return }

        follower.start(route: route)
        navigationSession = mapTemplate.startNavigationSession(for: trip)

        let maneuver = CPManeuver()
        maneuver.instructionVariants = ["Continue on trail", "Continue"]
        maneuver.dashboardInstructionVariants = ["Continue on trail"]
        maneuver.notificationInstructionVariants = ["Continue on trail"]
        maneuver.maneuverType = .followRoad

        navigationSession?.upcomingManeuvers = [maneuver]
        updateCarPlayEstimates(route: route, maneuver: maneuver)

        location.start()
    }

    func mapTemplate(
        _ mapTemplate: CPMapTemplate,
        selectedPreviewFor trip: CPTrip,
        using routeChoice: CPRouteChoice
    ) {
        // The route is already displayed by CarPlay's trip preview.
    }

    private func updateCarPlayEstimates(route: TrailmarkRoute, maneuver: CPManeuver) {
        let remaining = follower.state.distanceRemainingMeters ?? route.distanceMeters
        let time = max(1, remaining / 5.0)
        let estimates = CPTravelEstimates(
            distanceRemaining: Measurement(value: remaining, unit: .meters),
            timeRemaining: time
        )
        mapTemplate?.updateEstimates(estimates, for: route)
        navigationSession?.updateTravelEstimates(estimates, for: maneuver)
    }
}

final class CarPlayMapViewController: UIViewController {
    private let mapView = MKMapView()

    override func viewDidLoad() {
        super.viewDidLoad()
        mapView.frame = view.bounds
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mapView.showsUserLocation = true
        mapView.userTrackingMode = .followWithHeading
        view.addSubview(mapView)
    }
}
