import Foundation

final class OfflineRouteStore {
    static let shared = OfflineRouteStore()

    private let fileURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let queue = DispatchQueue(label: "com.mceleste.trailmark.offline-routes", qos: .utility)

    private init(fileManager: FileManager = .default) {
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = appSupport.appendingPathComponent("Trailmark", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        self.fileURL = directory.appendingPathComponent("offline-routes.json")
        encoder.outputFormatting = [.sortedKeys]
    }

    func save(routes: [TrailmarkRoute]) {
        queue.sync {
            do {
                let snapshot = OfflineRouteSnapshot(routes: routes, savedAtMs: Int64(Date().timeIntervalSince1970 * 1000))
                let data = try encoder.encode(snapshot)
                try data.write(to: fileURL, options: [.atomic])
            } catch {
                NSLog("Trailmark offline route save failed: \(error.localizedDescription)")
            }
        }
    }

    func loadRoutes() -> [TrailmarkRoute] {
        queue.sync {
            do {
                let data = try Data(contentsOf: fileURL)
                return try decoder.decode(OfflineRouteSnapshot.self, from: data).routes
            } catch {
                return []
            }
        }
    }
}

private struct OfflineRouteSnapshot: Codable {
    let routes: [TrailmarkRoute]
    let savedAtMs: Int64
}
