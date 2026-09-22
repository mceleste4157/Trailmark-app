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
        map.hidesButtonsWithNavigationBar = false

        let stop = CPBarButton(title: "Stop") { [weak self] _ in
            self?.stopNavigation()
        }
        map.trailingNavigationBarButtons = [stop]

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

    private func stopNavigation() {
        navigationSession?.cancelTrip()
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
        navigationSession = mapTemplate.startNavigationSession(for: trip)
        navigationSession?.pauseTrip(for: .loading, description: "Loading Trailmark route")
        // Route data and maneuvers are supplied by the native navigation engine
        // once a saved Trailmark route is selected.
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
