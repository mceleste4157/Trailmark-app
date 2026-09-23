import Foundation
import Combine

// Crew groups (join/create with a name+password so your crew sees each
// other) — the iOS counterpart of js/group/backend.js's getMyGroup/
// createGroup/joinGroup/leaveGroup and android/.../GroupRepository.kt.
// See sql/schema.sql's "Crew groups" section: create_group/join_group/
// leave_group/my_group are SECURITY DEFINER functions, so the password
// itself is never readable from the client, only checked server-side.
//
// Unlike Android (which has a full phone map to draw crew dots and a
// community-trails layer on), iOS's phone app has no map view at all
// yet — CarPlay's map is turn-by-turn only, not a place for crew
// presence or a static trail layer per the distracted-driving reasoning
// in docs/MOBILE_ARCHITECTURE.md. So this still broadcasts this
// device's own location to the group (so Android/web crew members can
// see the iPhone user), but doesn't attempt to render other members
// anywhere — there's nowhere to put them yet. Community trails aren't
// ported here for the same reason: nothing to draw them on.
struct TrailmarkGroup: Equatable {
    let id: String
    let name: String
}

@MainActor
final class SupabaseGroups: ObservableObject {
    static let shared = SupabaseGroups()

    @Published private(set) var currentGroup: TrailmarkGroup?
    @Published private(set) var isLoading = false

    private var locationCancellable: AnyCancellable?
    private var lastBroadcastAt = Date.distantPast

    private init() {}

    func refreshMyGroup() async {
        guard SupabaseAuth.shared.isSignedIn else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let rows = try await rpc("my_group", body: [:])
            applyGroup(from: rows)
        } catch {
            // Leave currentGroup as-is; the crew menu can retry.
        }
    }

    func createGroup(name: String, password: String) async throws {
        let rows = try await rpc("create_group", body: ["p_name": name, "p_password": password])
        applyGroup(from: rows)
    }

    func joinGroup(name: String, password: String) async throws {
        let rows = try await rpc("join_group", body: ["p_name": name, "p_password": password])
        applyGroup(from: rows)
    }

    func leaveGroup() async throws {
        _ = try await rpc("leave_group", body: [:])
        currentGroup = nil
        locationCancellable = nil
    }

    private func applyGroup(from rows: [[String: Any]]) {
        if let row = rows.first, let id = row["group_id"] as? String, !id.isEmpty {
            currentGroup = TrailmarkGroup(id: id, name: row["group_name"] as? String ?? "")
            startBroadcastingLocation()
        } else {
            currentGroup = nil
            locationCancellable = nil
        }
    }

    private func startBroadcastingLocation() {
        guard locationCancellable == nil else { return }
        locationCancellable = LocationService.shared.$lastFix
            .compactMap { $0 }
            .sink { [weak self] fix in
                self?.broadcastLocation(fix)
            }
    }

    private func broadcastLocation(_ fix: TrailmarkFix) {
        guard let group = currentGroup else { return }
        guard Date().timeIntervalSince(lastBroadcastAt) >= 15 else { return }
        lastBroadcastAt = Date()
        Task {
            try? await upsertLocation(fix: fix, groupId: group.id)
        }
    }

    private func upsertLocation(fix: TrailmarkFix, groupId: String) async throws {
        guard let token = SupabaseAuth.shared.accessToken, let uid = SupabaseAuth.shared.userId else { return }
        var request = URLRequest(url: TrailmarkConfig.supabaseURL.appendingPathComponent("rest/v1/locations"))
        request.httpMethod = "POST"
        request.setValue(TrailmarkConfig.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Upsert on the primary key (user_id) instead of erroring on
        // conflict — same "one row per user" presence model the web/
        // Android clients' location upserts rely on.
        request.setValue("resolution=merge-duplicates", forHTTPHeaderField: "Prefer")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "user_id": uid,
            "lat": fix.latitude,
            "lng": fix.longitude,
            "group_id": groupId
        ])
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "TrailmarkGroups", code: 2, userInfo: [NSLocalizedDescriptionKey: "Location update failed."])
        }
    }

    private func rpc(_ name: String, body: [String: Any]) async throws -> [[String: Any]] {
        guard let token = SupabaseAuth.shared.accessToken else {
            throw NSError(domain: "TrailmarkGroups", code: 1, userInfo: [NSLocalizedDescriptionKey: "Not signed in"])
        }
        var request = URLRequest(url: TrailmarkConfig.supabaseURL.appendingPathComponent("rest/v1/rpc/\(name)"))
        request.httpMethod = "POST"
        request.setValue(TrailmarkConfig.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])??["message"] as? String
            throw NSError(domain: "TrailmarkGroups", code: 3, userInfo: [NSLocalizedDescriptionKey: message ?? "Request failed."])
        }
        return (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }
}
