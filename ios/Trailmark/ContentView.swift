import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var location: LocationService

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Trailmark")
                    .font(.largeTitle.bold())
                Text(location.authorizationText)
                    .foregroundStyle(.secondary)
                if let fix = location.lastFix {
                    Text(String(format: "%.5f, %.5f", fix.latitude, fix.longitude))
                        .monospaced()
                }
                Button("Enable Location") {
                    location.requestAuthorization()
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
            .navigationTitle("Trailmark")
        }
    }
}
