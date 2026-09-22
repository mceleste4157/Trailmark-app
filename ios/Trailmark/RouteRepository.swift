import Foundation

final class RouteRepository {
    static let shared = RouteRepository()

    private init() {}

    func fetchRoutes() async throws -> [TrailmarkRoute] {
        guard let token = SupabaseAuth.shared.accessToken else {
            throw NSError(domain: "TrailmarkRoutes", code: 401, userInfo: [NSLocalizedDescriptionKey: "Sign in to Trailmark first."])
        }

        var components = URLComponents(
            url: TrailmarkConfig.supabaseURL.appendingPathComponent("rest/v1/shared_trails"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,name,kind,points,distance_meters"),
            URLQueryItem(name: "order", value: "created_at.desc"),
            URLQueryItem(name: "limit", value: "100")
        ]

        var request = URLRequest(url: components.url!)
        request.setValue(TrailmarkConfig.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "TrailmarkRoutes", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to load Trailmark routes (HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0))."])
        }

        return try JSONDecoder().decode([SharedTrailDTO].self, from: data).compactMap { $0.route }
    }

    private struct SharedTrailDTO: Decodable {
        let id: String
        let name: String
        let kind: String?
        let points: [PointDTO]
        let distanceMeters: Double?

        enum CodingKeys: String, CodingKey {
            case id, name, kind, points
            case distanceMeters = "distance_meters"
        }

        var route: TrailmarkRoute? {
            guard points.count >= 2 else { return nil }
            return TrailmarkRoute(
                id: id,
                name: name,
                kind: kind ?? "recorded",
                points: points.map {
                    TrailmarkPoint(
                        latitude: $0.lat,
                        longitude: $0.lng,
                        altitudeM: $0.ele,
                        timestampMs: $0.t.map(Int64.init)
                    )
                },
                distanceMeters: distanceMeters ?? calculateDistance()
            )
        }

        private func calculateDistance() -> Double {
            var total = 0.0
            for i in 0..<(points.count - 1) {
                let a = points[i], b = points[i + 1]
                let lat1 = a.lat * .pi / 180, lat2 = b.lat * .pi / 180
                let dLat = (b.lat - a.lat) * .pi / 180
                let dLon = (b.lng - a.lng) * .pi / 180
                let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
                total += 6_371_000 * 2 * asin(sqrt(h))
            }
            return total
        }
    }

    private struct PointDTO: Decodable {
        let lat: Double
        let lng: Double
        let ele: Double?
        let t: Double?
    }
}
