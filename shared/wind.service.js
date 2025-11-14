// src/services/wind.service.js
import axios from "axios";

/**
 * Convierte km/h a mph
 */
const kmhToMph = (kmh) => (kmh ? kmh / 1.609 : 0);

/**
 * Obtiene las estaciones meteorológicas de una zona
 */
const fetchZoneStations = async (zoneUrl) => {
  try {
    const { data } = await axios.get(zoneUrl);
    return data.properties?.observationStations ?? [];
  } catch (error) {
    console.warn(`⚠️ No se pudo obtener estaciones de la zona: ${zoneUrl}`);
    return [];
  }
};

/**
 * Obtiene datos de una estación: coordenadas y velocidad del viento
 */
const fetchStationObservation = async (stationUrl) => {
  try {
    const { data } = await axios.get(`${stationUrl}/observations/latest`);
    const coords = data.geometry?.coordinates ?? null;
    const props = data.properties ?? {};
    const windSpeedKmh = props.windSpeed?.value ?? 0; // puede venir null
    const windSpeedMph = kmhToMph(windSpeedKmh);

    return {
      stationUrl,
      coordinates: coords,
      windSpeedKmh,
      windSpeedMph,
    };
  } catch (error) {
    console.warn(
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
 * Obtiene alertas de viento y filtra las estaciones con viento >= 15 mph
 */
export const fetchWindAlerts = async () => {
  const state = process.env.STATE || "CA";
  const url = `https://api.weather.gov/alerts/active?area=${state}`;

  try {
    console.log(`🌪️ Obteniendo alertas activas para ${state}...`);
    const { data } = await axios.get(url);

    // Filtrar solo alertas relacionadas con viento
    const windAlerts = (data.features || []).filter((a) =>
      a.properties?.event?.toLowerCase().includes("winter")
    );

    console.log(
      `💨 Se encontraron ${windAlerts.length} alertas de viento activas.`
    );

    const results = [];

    for (const alert of windAlerts) {
      try {
        const affectedZones = alert.properties?.affectedZones ?? [];

        // Obtener estaciones por zona (en paralelo) con manejo de errores
        const allStations = (
          await Promise.all(
            affectedZones.map(async (zone) => {
              try {
                return await fetchZoneStations(zone);
              } catch (zoneErr) {
                console.error(
                  `❌ Error obteniendo estaciones para zona ${zone}:`,
                  zoneErr
                );
                return [];
              }
            })
          )
        ).flat();

        // Eliminar duplicados
        const uniqueStations = [...new Set(allStations)];

        // Obtener observaciones por estación (en paralelo) con manejo de errores
        const observations = await Promise.all(
          uniqueStations.map(async (station) => {
            try {
              return await fetchStationObservation(station);
            } catch (obsErr) {
              console.error(
                `❌ Error obteniendo observación para estación ${station}:`,
                obsErr
              );
              return null;
            }
          })
        );

        // Filtrar solo observaciones válidas y con viento >= 15 mph
        const stationsWithWind = observations
          .filter((o) => o && o.coordinates && o.windSpeedMph >= 15)
          .map((o) => ({
            stationUrl: o.stationUrl,
            coordinates: o.coordinates,
            windSpeedKmh: o.windSpeedKmh,
            windSpeedMph: o.windSpeedMph,
          }));

        if (stationsWithWind.length > 0) {
          console.log(
            `✅ Alerta: ${alert.properties.event} (${stationsWithWind.length} estaciones con ≥ 15 mph)`
          );

          results.push({
            id: alert.id,
            event: alert.properties.event,
            headline: alert.properties.headline,
            observationStations: stationsWithWind.map((s) => s.stationUrl),
            stations: stationsWithWind,
            affectedZones,
            sent: alert.properties.sent,
          });
        }
      } catch (alertErr) {
        console.error(`❌ Error procesando alerta ${alert.id}:`, alertErr);
      }
    }

    console.log(
      `🏁 Proceso completado. ${results.length} alertas relevantes encontradas.`
    );
    return results;
  } catch (err) {
    console.error("❌ Error al obtener alertas de viento desde la API:", err);
    return []; // Retorna un array vacío si falla todo
  }
};
