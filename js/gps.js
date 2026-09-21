// GPS trail recording via the browser Geolocation API. This works fully
// offline — it reads the device's GPS hardware, not the network.
const GpsRecorder = (() => {
  let watchId = null;
  let points = [];
  let startedAt = null;
  let onUpdate = () => {};

  function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function totalDistanceMeters() {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversineMeters(points[i - 1], points[i]);
    }
    return total;
  }

  function start(updateCallback) {
    if (!("geolocation" in navigator)) {
      throw new Error("Geolocation is not available on this device.");
    }
    points = [];
    startedAt = Date.now();
    onUpdate = updateCallback || (() => {});

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const point = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ele: pos.coords.altitude,
          t: Date.now(),
        };
        points.push(point);
        onUpdate({ points, distanceMeters: totalDistanceMeters() });
      },
      (err) => {
        console.warn("GPS error:", err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );
  }

  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    return {
      points,
      distanceMeters: totalDistanceMeters(),
      startedAt,
      endedAt: Date.now(),
    };
  }

  function isRecording() {
    return watchId !== null;
  }

  return { start, stop, isRecording };
})();
