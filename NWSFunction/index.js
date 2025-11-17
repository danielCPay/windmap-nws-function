import { fetchWindAlerts } from "../shared/wind.service.js";
import mysql from "mysql2/promise";

export async function run(context, timer) {
  context.log("🌪️ Ejecutando NWSFunction...");

  try {
    const alerts = await fetchWindAlerts(context);
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

    let cambios = 0;

    // 🧾 Insertar o actualizar cada alerta
    for (const alert of alerts) {
      // 🔧 Normalizar JSON para evitar falsos cambios
      const details = JSON.stringify(alert, Object.keys(alert).sort());

      const [result] = await connection.execute(
        `INSERT INTO alerts (id, event, headline, sent, details, is_processed)
         VALUES (?, ?, ?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE
           headline = IF(headline <> VALUES(headline), VALUES(headline), headline),
           details = IF(details <> VALUES(details), VALUES(details), details),
           sent = IF(sent <> VALUES(sent), VALUES(sent), sent),
           updated_at = IF(
              headline <> VALUES(headline)
              OR details <> VALUES(details)
              OR sent <> VALUES(sent),
              CURRENT_TIMESTAMP,
              updated_at
           ),
           is_processed = IF(
              headline <> VALUES(headline)
              OR details <> VALUES(details)
              OR sent <> VALUES(sent),
              0,
              is_processed
           )`,
        [alert.id, alert.event, alert.headline, alert.sent, details]
      );
      if (result.affectedRows === 1) {
        cambios++;
        context.log(`🟢 Insert nueva alerta: ${alert.id}`);
      } else if (result.affectedRows === 2) {
        cambios++;
        context.log(`🔵 Alerta actualizada: ${alert.id}`);
      } else {
        context.log(`⚪ Sin cambios: ${alert.id}`);
      }
    }

    await connection.end();

    // Mostrar mensaje solo cuando realmente hubo cambios:
    if (cambios > 0) {
      context.log("💾 Alertas registradas correctamente en la base de datos.");
    } else {
      context.log("ℹ️ No hubo nuevas alertas ni actualizaciones.");
    }
  } catch (error) {
    context.log.error("❌ Error ejecutando NWSFunction:", error);
  }

  // context.done();
}
