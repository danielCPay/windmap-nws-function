// src/services/wind.service.js
import axios from "axios";

// 🟦 User-Agent obligatorio (si no, NWS bloquea peticiones masivas)
axios.defaults.headers.common["User-Agent"] =
  "WindMapApp/1.0 (daniel.escobar.app)";

// 🟦 Cache en memoria
const zoneCache = new Map(); // zona → { data, timestamp }
const stationCache = new Map(); // stationUrl → { data, timestamp }
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

/**
 * Convierte km/h a mph
 */
const kmhToMph = (kmh) => (kmh ? kmh / 1.609 : 0);

/**
 * Verifica si un cache aún es válido
 */
const isValidCache = (entry) => {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL;
};

/**
 * Obtiene las estaciones de una zona, con cache
 */
const fetchZoneStations = async (zoneUrl, context) => {
  // 🔹 Revisar cache
  if (isValidCache(zoneCache.get(zoneUrl))) {
    return zoneCache.get(zoneUrl).data;
  }

  try {
    const { data } = await axios.get(zoneUrl);
    const stations = data.properties?.observationStations ?? [];

    // 🔹 Guardar en cache
    zoneCache.set(zoneUrl, { data: stations, timestamp: Date.now() });

    return stations;
  } catch (error) {
    context.log.warn(`⚠️ No se pudo obtener estaciones de la zona: ${zoneUrl}`);
    return [];
  }
};

/**
 * Obtiene observaciones de una estación, con cache
 */
const fetchStationObservation = async (stationUrl, context) => {
  // 🔹 Cache existente?
  if (isValidCache(stationCache.get(stationUrl))) {
    return stationCache.get(stationUrl).data;
  }

  try {
    const { data } = await axios.get(`${stationUrl}/observations/latest`);
    const coords = data.geometry?.coordinates ?? null;
    const props = data.properties ?? {};
    const windSpeedKmh = props.windSpeed?.value ?? 0;
    const windSpeedMph = kmhToMph(windSpeedKmh);

    const result = {
      stationUrl,
      coordinates: coords,
      windSpeedKmh,
      windSpeedMph,
    };

    // 🔹 Guardar en cache
    stationCache.set(stationUrl, { data: result, timestamp: Date.now() });

    return result;
  } catch (error) {
    context.log.warn(
      `⚠️ No se pudo obtener observaciones de la estación: ${stationUrl}`
    );
    return {
      stationUrl,
      coordinates: null,
      windSpeedKmh: 0,
      windSpeedMph: 0,
    };
  }
};

/**
 * Obtiene alertas de viento y filtra estaciones con ≥ 15 mph
 */
export const fetchWindAlerts = async (context) => {
  const state = process.env.STATE || "CA";
  const url = `https://api.weather.gov/alerts/active?area=${state}`;

  try {
    context.log(`🌪️ Obteniendo alertas activas para ${state}...`);
    const { data } = await axios.get(url);

    const windAlerts = (data.features || []).filter((a) =>
      a.properties?.event?.toLowerCase().includes("wind")
    );

    context.log(`💨 ${windAlerts.length} alertas de viento detectadas.`);

    const results = [];

    for (const alert of windAlerts) {
      const affectedZones = alert.properties?.affectedZones ?? [];

      // 🔵 Obtener estaciones por zona (con cache)
      const zoneStationLists = await Promise.all(
        affectedZones.map(async (zone) => {
          try {
            return await fetchZoneStations(zone, context);
          } catch {
            return [];
          }
        })
      );

      const uniqueStations = [...new Set(zoneStationLists.flat())];

      // 🔵 Obtener observaciones de estaciones (con cache)
      const observations = await Promise.all(
        uniqueStations.map(async (station) => {
          try {
            return await fetchStationObservation(station, context);
          } catch {
            return null;
          }
        })
      );

      const validStations = observations
        .filter((o) => o && o.coordinates && o.windSpeedMph >= 15)
        .map((o) => ({
          stationUrl: o.stationUrl,
          coordinates: o.coordinates,
          windSpeedKmh: o.windSpeedKmh,
          windSpeedMph: o.windSpeedMph,
        }));

      if (validStations.length > 0) {
        results.push({
          id: alert.id,
          event: alert.properties.event,
          headline: alert.properties.headline,
          observationStations: validStations.map((s) => s.stationUrl),
          stations: validStations,
          affectedZones,
          sent: alert.properties.sent,
        });
      }
    }

    context.log(`🏁 ${results.length} alertas relevantes finales.`);
    return results;
  } catch (error) {
    context.log.error("❌ Error al obtener alertas:", error);
    return [];
  }
};
