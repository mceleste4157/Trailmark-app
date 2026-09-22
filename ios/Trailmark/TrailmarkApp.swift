import SwiftUI

@main
struct TrailmarkApp: App {
    @StateObject private var location = LocationService.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(location)
        }
    }
}
