import Foundation
import Security

enum TrailmarkConfig {
    static let supabaseURL = URL(string: "https://nvbtwgigniodfumjukdo.supabase.co")!
    static let publishableKey = "sb_publishable_6F7NiQxUXnMJXNCh8YL7kA_R97zntAB"
}

final class SupabaseAuth: ObservableObject {
    static let shared = SupabaseAuth()
    @Published private(set) var accessToken: String?

    private let tokenKey = "trailmark.supabase.access-token"

    private init() {
        accessToken = loadToken()
    }

    var isSignedIn: Bool { accessToken != nil }

    func signIn(email: String, password: String) async throws {
        var request = URLRequest(url: TrailmarkConfig.supabaseURL.appendingPathComponent("auth/v1/token?grant_type=password"))
        request.httpMethod = "POST"
        request.setValue(TrailmarkConfig.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Supabase sign-in failed."
            throw NSError(domain: "TrailmarkAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }

        let payload = try JSONDecoder().decode(TokenResponse.self, from: data)
        saveToken(payload.accessToken)
        await MainActor.run { self.accessToken = payload.accessToken }
    }

    func signOut() {
        deleteToken()
        accessToken = nil
    }

    private struct TokenResponse: Decodable {
        let accessToken: String
        enum CodingKeys: String, CodingKey { case accessToken = "access_token" }
    }

    private func saveToken(_ token: String) {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tokenKey,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func loadToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tokenKey,
            kSecReturnData as String: true
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tokenKey
        ]
        SecItemDelete(query as CFDictionary)
    }
}
