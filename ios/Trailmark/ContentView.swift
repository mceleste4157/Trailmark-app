import SwiftUI
import MapKit

struct ContentView: View {
    @EnvironmentObject private var location: LocationService
    @Environment(\.openURL) private var openURL
    @StateObject private var auth = SupabaseAuth.shared
    @StateObject private var groups = SupabaseGroups.shared

    @State private var routes: [TrailmarkRoute] = []
    @State private var activeRoute: TrailmarkRoute?
    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 33.749, longitude: -84.388),
            span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
        )
    )
    @State private var satelliteMode = false
    @State private var routeVisible = true
    @State private var lightChrome = false
    @State private var showingRoutes = false
    @State private var showingAccount = false
    @State private var showingCrew = false
    @State private var notice: String?

    private let chrome = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255)

    var body: some View {
        Map(position: $position) {
            if routeVisible, let route = activeRoute {
                MapPolyline(coordinates: route.coordinates)
                    .stroke(.white, lineWidth: 9)
                MapPolyline(coordinates: route.coordinates)
                    .stroke(.red, lineWidth: 5)
            }

            if let fix = location.lastFix {
                Annotation("Current location", coordinate: fix.coordinate) {
                    ZStack {
                        Circle().fill(.white).frame(width: 30, height: 30)
                        Image(systemName: "location.north.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.blue)
                    }
                    .shadow(radius: 2)
                }
            }
        }
        .mapStyle(satelliteMode ? .imagery : .standard)
        .safeAreaInset(edge: .top, spacing: 0) { topChrome }
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomNavigation }
        .preferredColorScheme(lightChrome ? .light : .dark)
        .confirmationDialog("My Content", isPresented: $showingRoutes, titleVisibility: .visible) {
            if routes.isEmpty {
                Button("No saved routes available", role: .cancel) {}
            } else {
                ForEach(routes) { route in
                    Button(route.name) { selectRoute(route) }
                }
            }
        }
        .sheet(isPresented: $showingAccount) {
            AccountSheet(auth: auth, groups: groups)
        }
        .sheet(isPresented: $showingCrew) {
            CrewSheet(auth: auth, groups: groups)
        }
        .alert("Trailmark", isPresented: noticePresented) {
            Button("OK", role: .cancel) { notice = nil }
        } message: {
            Text(notice ?? "")
        }
        .task { await loadRoutes() }
        .onChange(of: auth.isSignedIn) { _, signedIn in
            Task {
                await loadRoutes()
                if signedIn { await groups.refreshMyGroup() }
            }
        }
    }

    private var topChrome: some View {
        VStack(spacing: 6) {
            HStack {
                Text("Trailmark")
                    .font(.title2.bold())
                Spacer()
                Text("v1.0.0")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.25))
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    controlButton(satelliteMode ? "Satellite" : "Streets", systemImage: satelliteMode ? "airplane" : "map") {
                        satelliteMode.toggle()
                    }
                    controlButton("Layers", systemImage: "square.3.layers.3d") {
                        routeVisible.toggle()
                    }
                    controlButton("Weather", systemImage: "cloud.sun") { openWeather() }
                    iconButton("Account", systemImage: "gearshape") { showingAccount = true }
                    iconButton("Toggle theme", systemImage: lightChrome ? "moon" : "sun.max") {
                        lightChrome.toggle()
                    }
                    Text("online")
                        .font(.caption)
                        .foregroundStyle(.green)
                        .padding(.horizontal, 10)
                        .frame(height: 34)
                        .background(.black.opacity(0.25))
                }
            }

            HStack(spacing: 0) {
                stat(speedText, label: "mph")
                stat(headingText, label: "N-UP")
                stat(elevationText, label: "ft elev")
                stat("--", label: "tilt")
            }
            .padding(.vertical, 5)
            .background(.black.opacity(0.25))

            Text(routeStatus)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(1)
        }
        .foregroundStyle(lightChrome ? Color.primary : Color.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(lightChrome ? Color(.systemBackground).opacity(0.96) : chrome.opacity(0.97))
    }

    private var bottomNavigation: some View {
        HStack(spacing: 0) {
            navButton("Go & Track", systemImage: "location.north.circle.fill") { centerMap() }
            navButton("Tools", systemImage: "hammer.fill") {
                if location.authorization == .denied {
                    notice = "Enable location for Trailmark in iPhone Settings."
                } else {
                    location.requestAuthorization()
                }
            }
            navButton("My Content", systemImage: "folder.fill") { showingRoutes = true }
            navButton("Offline Maps", systemImage: "square.and.arrow.down.fill") {
                notice = routes.isEmpty
                    ? "Sign in and load a route before saving it for offline use."
                    : "Saved Trailmark routes remain available offline on this iPhone."
            }
            navButton("Chat", systemImage: "bubble.left.fill") { showingCrew = true }
        }
        .padding(.vertical, 9)
        .background(chrome.opacity(0.97))
        .foregroundStyle(.white)
    }

    private func controlButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.caption)
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(.black.opacity(0.25))
        }
        .buttonStyle(.plain)
    }

    private func iconButton(_ description: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .frame(width: 36, height: 34)
                .background(.black.opacity(0.25))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(description)
    }

    private func stat(_ value: String, label: String) -> some View {
        VStack(spacing: 1) {
            Text(value).font(.callout)
            Text(label).font(.caption)
        }
        .frame(maxWidth: .infinity)
    }

    private func navButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: systemImage).font(.title3)
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
        }
        .buttonStyle(.plain)
    }

    private var speedText: String {
        guard let speed = location.lastFix?.speedMps else { return "--" }
        return String(Int(speed * 2.236936))
    }

    private var headingText: String {
        guard let heading = location.lastFix?.bearingDeg else { return "↑ --" }
        return "↑ \(Int(heading))°"
    }

    private var elevationText: String {
        guard let altitude = location.lastFix?.altitudeM else { return "--" }
        return String(Int(altitude * 3.28084))
    }

    private var routeStatus: String {
        guard let route = activeRoute else { return routes.isEmpty ? "No saved routes" : "Select a saved trail" }
        return String(format: "%@ · %.1f mi", route.name, route.distanceMeters / 1609.344)
    }

    private var noticePresented: Binding<Bool> {
        Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
    }

    @MainActor
    private func loadRoutes() async {
        do {
            routes = try await RouteRepository.shared.fetchRoutes()
            if activeRoute == nil, let first = routes.first { selectRoute(first) }
        } catch {
            notice = error.localizedDescription
        }
    }

    private func selectRoute(_ route: TrailmarkRoute) {
        activeRoute = route
        frame(route)
    }

    private func centerMap() {
        location.requestAuthorization()
        if let fix = location.lastFix {
            position = .region(MKCoordinateRegion(
                center: fix.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
            ))
        } else if let route = activeRoute {
            frame(route)
        }
    }

    private func frame(_ route: TrailmarkRoute) {
        guard let first = route.points.first else { return }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for point in route.points.dropFirst() {
            minLat = min(minLat, point.latitude)
            maxLat = max(maxLat, point.latitude)
            minLon = min(minLon, point.longitude)
            maxLon = max(maxLon, point.longitude)
        }
        position = .region(MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
            span: MKCoordinateSpan(
                latitudeDelta: max((maxLat - minLat) * 1.5, 0.01),
                longitudeDelta: max((maxLon - minLon) * 1.5, 0.01)
            )
        ))
    }

    private func openWeather() {
        let coordinate = location.lastFix?.coordinate ?? activeRoute?.points.first.map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }
        guard let coordinate,
              let url = URL(string: "https://forecast.weather.gov/MapClick.php?lat=\(coordinate.latitude)&lon=\(coordinate.longitude)") else {
            notice = "Choose a route or enable location to view local weather."
            return
        }
        openURL(url)
    }
}

private struct AccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var auth: SupabaseAuth
    @ObservedObject var groups: SupabaseGroups
    @State private var email = ""
    @State private var password = ""
    @State private var errorMessage = ""

    var body: some View {
        NavigationStack {
            Form {
                if auth.isSignedIn {
                    Section {
                        Text("Signed in to Trailmark")
                        Button("Sign Out", role: .destructive) { auth.signOut() }
                    }
                } else {
                    Section("Trailmark Account") {
                        TextField("Email", text: $email)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textContentType(.username)
                        SecureField("Password", text: $password)
                        Button("Sign In") { signIn() }
                    }
                }
                if !errorMessage.isEmpty {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle("Account")
            .toolbar { Button("Done") { dismiss() } }
        }
    }

    private func signIn() {
        Task {
            do {
                try await auth.signIn(email: email, password: password)
                errorMessage = ""
                await groups.refreshMyGroup()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct CrewSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var auth: SupabaseAuth
    @ObservedObject var groups: SupabaseGroups

    var body: some View {
        NavigationStack {
            Group {
                if auth.isSignedIn {
                    CrewGroupSection(groups: groups)
                } else {
                    ContentUnavailableView(
                        "Sign In Required",
                        systemImage: "person.2.fill",
                        description: Text("Sign in from Settings to join or create a crew group.")
                    )
                }
            }
            .navigationTitle("Crew")
            .toolbar { Button("Done") { dismiss() } }
            .task { if auth.isSignedIn { await groups.refreshMyGroup() } }
        }
    }
}

private struct CrewGroupSection: View {
    @ObservedObject var groups: SupabaseGroups
    @State private var groupName = ""
    @State private var groupPassword = ""
    @State private var errorMessage = ""

    var body: some View {
        Form {
            if let group = groups.currentGroup {
                Section("Current Crew") {
                    Text(group.name).font(.headline)
                    Text("Your location is shared with this crew while Trailmark is active.")
                        .foregroundStyle(.secondary)
                    Button("Leave Group", role: .destructive) {
                        Task { await perform { try await groups.leaveGroup() } }
                    }
                }
            } else {
                Section("Join or Create") {
                    TextField("Group name", text: $groupName)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Group password", text: $groupPassword)
                    Button("Join Group") { submit(groups.joinGroup) }
                    Button("Create New Group") { submit(groups.createGroup) }
                }
            }
            if !errorMessage.isEmpty {
                Text(errorMessage).foregroundStyle(.red)
            }
        }
    }

    private func submit(_ action: @escaping (String, String) async throws -> Void) {
        let name = groupName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !groupPassword.isEmpty else {
            errorMessage = "Group name and password are both required."
            return
        }
        Task { await perform { try await action(name, groupPassword) } }
    }

    @MainActor
    private func perform(_ action: () async throws -> Void) async {
        do {
            try await action()
            errorMessage = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private extension TrailmarkRoute {
    var coordinates: [CLLocationCoordinate2D] {
        points.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
    }
}

private extension TrailmarkFix {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
