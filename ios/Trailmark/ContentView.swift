import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var location: LocationService
    @StateObject private var auth = SupabaseAuth.shared
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
        }
    }
}
