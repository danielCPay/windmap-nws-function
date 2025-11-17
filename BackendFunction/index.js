import mysql from "mysql2/promise";
import axios from "axios";

export async function run(context, req) {
  context.log("🚀 Ejecutando BackendFunction...");

  try {
    // 📌 1. Conexión MySQL
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    });

    // 📌 2. Leer alertas no procesadas
    const [rows] = await connection.execute(`
      SELECT id, event, headline, sent, details
      FROM alerts
      WHERE is_processed = 0
    `);

    if (rows.length === 0) {
      context.log("ℹ️ No hay alertas pendientes.");
      await connection.end();
      return;
    }

    context.log(`📥 ${rows.length} alertas pendientes encontradas.`);

    // 📌 3. Parsear JSON y extraer coordenadas
    const alertsWithCoords = rows.map((row) => {
      let parsed;

      try {
        // 👉 Si ya es objeto, úsalo
        if (typeof row.details === "object") {
          parsed = row.details;
        } else {
          // 👉 Si es string, intenta parsearlo
          parsed = JSON.parse(row.details);
        }
      } catch (err) {
        context.log.error(
          `❌ Error parseando el JSON de details en alerta ${row.id}:`,
          err.message
        );
        return {
          id: row.id,
          event: row.event,
          headline: row.headline,
          sent: row.sent,
          coordinates: [],
        };
      }

      const coords =
        parsed.stations?.map((s) => ({
          stationUrl: s.stationUrl,
          lat: s.coordinates?.[1] ?? null,
          lon: s.coordinates?.[0] ?? null,
          windSpeedMph: s.windSpeedMph,
        })) ?? [];

      return {
        id: row.id,
        event: row.event,
        headline: row.headline,
        sent: row.sent,
        coordinates: coords,
      };
    });

    // 📌 4. Enviar cada estación al API de Property
    for (const alert of alertsWithCoords) {
      for (const station of alert.coordinates) {
        try {
          /*await axios.post(process.env.PROPERTY_API_URL, {
            alertId: alert.id,
            event: alert.event,
            headline: alert.headline,
            latitude: station.lat,
            longitude: station.lon,
            windSpeedMph: station.windSpeedMph,
          });*/

          context.log(
            `📤 Enviado a Property API → ${station.lat}, ${station.lon} (${station.windSpeedMph} mph)`
          );
        } catch (err) {
          context.log.error(
            `❌ Error enviando coordenadas a Property API (${alert.id}):`,
            err.message
          );
        }
      }
    }

    // 📌 5. Marcar alertas como procesadas
    await connection.execute(`
      UPDATE alerts
      SET is_processed = 1
      WHERE is_processed = 0
    `);

    context.log("✅ Alertas marcadas como procesadas.");

    await connection.end();
  } catch (error) {
    context.log.error("❌ Error en BackendFunction:", error);
  }
}
