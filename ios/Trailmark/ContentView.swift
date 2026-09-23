import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var location: LocationService
    @StateObject private var auth = SupabaseAuth.shared
    @StateObject private var groups = SupabaseGroups.shared
    @State private var email = ""
    @State private var password = ""
    @State private var errorMessage = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Trailmark")
                    .font(.largeTitle.bold())

                if auth.isSignedIn {
                    Text("Signed in")
                        .foregroundStyle(.secondary)
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

                    CrewGroupSection(groups: groups)

                    Button("Sign Out", role: .destructive) {
                        auth.signOut()
                    }
                } else {
                    TextField("Email", text: $email)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.username)
                        .textFieldStyle(.roundedBorder)
                    SecureField("Password", text: $password)
                        .textFieldStyle(.roundedBorder)

                    Button("Sign In") {
                        Task {
                            do {
                                try await auth.signIn(email: email, password: password)
                                errorMessage = ""
                                await groups.refreshMyGroup()
                            } catch {
                                errorMessage = error.localizedDescription
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)

                    if !errorMessage.isEmpty {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }
            }
            .padding()
            .navigationTitle("Trailmark")
            .task {
                if auth.isSignedIn { await groups.refreshMyGroup() }
            }
        }
    }
}

// Join/create/leave a crew group — see SupabaseGroups.swift for why this
// stops at presence (broadcasting your own location to the group) rather
// than also showing crew members or community trails: there's no phone
// map to draw either on yet, unlike the Android app.
private struct CrewGroupSection: View {
    @ObservedObject var groups: SupabaseGroups
    @State private var groupName = ""
    @State private var groupPassword = ""
    @State private var errorMessage = ""

    var body: some View {
        VStack(spacing: 8) {
            if let group = groups.currentGroup {
                Text("Crew: \(group.name)")
                    .font(.headline)
                Text("Your location is shared with this crew.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Leave Group", role: .destructive) {
                    Task {
                        do {
                            try await groups.leaveGroup()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                }
            } else {
                Text("No crew group yet")
                    .font(.headline)
                Text("Join with a name + password your crew shares, or start a new one.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextField("Group name", text: $groupName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                SecureField("Group password", text: $groupPassword)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Button("Join") { submit(groups.joinGroup) }
                        .buttonStyle(.bordered)
                    Button("Create New") { submit(groups.createGroup) }
                        .buttonStyle(.bordered)
                }
            }
            if !errorMessage.isEmpty {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(.footnote)
            }
        }
        .padding()
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.secondary.opacity(0.3)))
    }

    private func submit(_ action: @escaping (String, String) async throws -> Void) {
        let name = groupName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !groupPassword.isEmpty else {
            errorMessage = "Group name and password are both required."
            return
        }
        Task {
            do {
                try await action(name, groupPassword)
                errorMessage = ""
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
