// netlify/functions/crear-pago.js
// Esta función corre en el servidor — el Access Token nunca llega al navegador

const SUPA_URL = "https://qivrxcjqynjpukqdauiy.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpdnJ4Y2pxeW5qcHVrcWRhdWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNDA2NjMsImV4cCI6MjA5NjYxNjY2M30.g52ABcgrte5mZWWeD90fDj0tPeOM5E4XZMZd0l2vnI8";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "APP_USR-241066986448081-061616-a76127984a45611911d82072fb2dda34-156957990";
const BASE_URL = process.env.URL || "https://thriving-mooncake-1cfe3a.netlify.app";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  try {
    const { items, cliente } = JSON.parse(event.body);

    if (!items || !items.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Carrito vacío" }) };
    }

    // Verificar stock en Supabase antes de crear el pago
    for (const item of items) {
      const res = await fetch(
        `${SUPA_URL}/rest/v1/perfumes?id=eq.${item.perfume_id}&select=id,nombre,precio`,
        { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
      );
      const perfumes = await res.json();
      if (!perfumes.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Producto no encontrado: ${item.nombre}` }) };
      }
    }

    // Crear preferencia de pago en Mercado Pago
    const preference = {
      items: items.map(item => ({
        id: item.perfume_id,
        title: item.nombre,
        description: `V&F Jewelry & Parfum — ${item.nombre} 60ml`,
        picture_url: "https://thriving-mooncake-1cfe3a.netlify.app/logo.jpg",
        category_id: "others",
        quantity: item.cantidad,
        unit_price: parseFloat(item.precio)
      })),
      payer: cliente ? {
        name: cliente.nombre || "",
        email: cliente.email || "",
        phone: { number: cliente.telefono || "" }
      } : undefined,
      back_urls: {
        success: `${BASE_URL}/pago-exitoso.html`,
        failure: `${BASE_URL}/pago-fallido.html`,
        pending: `${BASE_URL}/pago-pendiente.html`
      },
      auto_return: "approved",
      notification_url: `${BASE_URL}/api/webhook-pago`,
      statement_descriptor: "VYF JEWELRY PARFUM",
      external_reference: `VYF-${Date.now()}`,
      metadata: {
        items_data: JSON.stringify(items),
        cliente_data: JSON.stringify(cliente || {})
      }
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preference)
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error("Error Mercado Pago:", mpData);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Error al crear el pago", detalle: mpData.message })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: mpData.id,
        init_point: mpData.init_point,       // URL de pago producción
        sandbox_init_point: mpData.sandbox_init_point  // URL de prueba
      })
    };

  } catch (err) {
    console.error("Error en crear-pago:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Error interno", detalle: err.message })
    };
  }
};
