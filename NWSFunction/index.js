import { fetchWindAlerts } from "../shared/wind.service.js";
import mysql from "mysql2/promise";

export async function run(context, timer) {
  context.log("🌪️ Ejecutando NWSFunction...");

  try {
    const alerts = await fetchWindAlerts();
    context.log(`✅ Se obtuvieron ${alerts.length} alertas relevantes`);

    // Si NO hay alertas, NO seguir
    if (alerts.length === 0) {
      context.log(
        "ℹ️ No hay alertas relevantes. No se registró nada en la base de datos."
      );
      return;
    }

    // Conexión a MySQL
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    });

    // 🧾 Insertar o actualizar cada alerta
    for (const alert of alerts) {
      await connection.execute(
        `INSERT INTO alerts (id, event, headline, sent, details, is_processed)
         VALUES (?, ?, ?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE
           headline = VALUES(headline),
           details = VALUES(details),
           sent = VALUES(sent),
           updated_at = CURRENT_TIMESTAMP,
           is_processed = 0`, // reinicia el flag
        [
          alert.id,
          alert.event,
          alert.headline,
          alert.sent,
          JSON.stringify(alert),
        ]
      );
    }

    await connection.end();
    context.log("💾 Alertas registradas correctamente en la base de datos.");
  } catch (error) {
    context.log.error("❌ Error ejecutando NWSFunction:", error);
  }

  // context.done();
}
