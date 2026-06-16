// netlify/functions/webhook-pago.js
// Recibe notificaciones de Mercado Pago cuando un pago es aprobado
// Descuenta stock en Supabase y registra la venta

const SUPA_URL = "https://qivrxcjqynjpukqdauiy.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpdnJ4Y2pxeW5qcHVrcWRhdWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNDA2NjMsImV4cCI6MjA5NjYxNjY2M30.g52ABcgrte5mZWWeD90fDj0tPeOM5E4XZMZd0l2vnI8";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "APP_USR-241066986448081-061616-a76127984a45611911d82072fb2dda34-156957990";

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPA_URL}${path}`, {
    method: opts.method || "GET",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer !== undefined ? opts.prefer : "return=representation"
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

exports.handler = async (event) => {
  // Mercado Pago envía GET para verificar el webhook
  if (event.httpMethod === "GET") {
    return { statusCode: 200, body: "OK" };
  }

  try {
    const params = event.queryStringParameters || {};
    const topic = params.topic || params.type;

    // Solo procesar pagos aprobados
    if (topic !== "payment") {
      return { statusCode: 200, body: "Ignorado" };
    }

    const paymentId = params.id || params["data.id"];
    if (!paymentId) {
      return { statusCode: 400, body: "Sin payment_id" };
    }

    // Obtener detalles del pago desde Mercado Pago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const pago = await mpRes.json();

    console.log("Pago recibido:", pago.id, "Status:", pago.status);

    // Solo procesar si fue aprobado
    if (pago.status !== "approved") {
      return { statusCode: 200, body: `Pago ${pago.status} — sin acción` };
    }

    // Extraer items del metadata
    const metadata = pago.metadata || {};
    let items = [];
    try {
      items = JSON.parse(metadata.items_data || "[]");
    } catch (e) {
      console.error("Error parseando items_data:", e);
      // Intentar reconstruir desde additional_info
      items = (pago.additional_info?.items || []).map(i => ({
        perfume_id: i.id,
        nombre: i.title,
        cantidad: parseInt(i.quantity) || 1,
        precio: parseFloat(i.unit_price) || 0
      }));
    }

    let cliente = {};
    try { cliente = JSON.parse(metadata.cliente_data || "{}"); } catch (e) {}

    // Procesar cada item: descontar stock y registrar venta
    for (const item of items) {
      // 1. Obtener perfume y stock actual
      const perfumes = await sb(`/rest/v1/perfumes?id=eq.${item.perfume_id}&select=id,nombre,precio`);
      if (!perfumes.length) {
        console.error("Perfume no encontrado:", item.perfume_id);
        continue;
      }
      const perfume = perfumes[0];

      // 2. Obtener lotes producidos para calcular stock
      // El stock real se calcula en el sistema, pero aquí necesitamos
      // simplemente registrar la venta y el stock se recalcula automáticamente
      // cuando el sistema hace la consulta

      // 3. Registrar venta en Supabase
      // Usamos user_id del sistema — necesitamos un user_id válido
      // Para ventas online usamos un user_id especial o el del dueño
      // Por ahora buscamos cualquier usuario existente
      const perfiles = await sb("/rest/v1/perfiles?select=id&limit=1");
      const userId = perfiles.length ? perfiles[0].id : null;

      if (!userId) {
        console.error("No hay usuario registrado en el sistema");
        continue;
      }

      const ventaBody = {
        user_id: userId,
        perfume_id: item.perfume_id,
        perfume_nombre: perfume.nombre || item.nombre,
        cantidad: parseInt(item.cantidad) || 1,
        precio_venta: parseFloat(item.precio) || parseFloat(perfume.precio) || 250,
        costo_unitario: 0, // Se calculará con las recetas
        ganancia: 0, // Se calculará después
        canal: "Tienda en línea",
        fecha: new Date().toISOString().slice(0, 10),
        notas: `Pago MP #${pago.id} — ${cliente.nombre || "Cliente web"} ${cliente.email || ""}`
      };

      const ventaRes = await sb("/rest/v1/ventas", {
        method: "POST",
        body: ventaBody,
        prefer: "return=minimal"
      });

      console.log(`✓ Venta registrada: ${perfume.nombre} x${item.cantidad}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, pago_id: pago.id, items_procesados: items.length })
    };

  } catch (err) {
    console.error("Error en webhook:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
