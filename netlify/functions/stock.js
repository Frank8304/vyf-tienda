// netlify/functions/stock.js
// Devuelve el stock disponible de todos los perfumes desde Supabase

const SUPA_URL = "https://qivrxcjqynjpukqdauiy.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpdnJ4Y2pxeW5qcHVrcWRhdWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNDA2NjMsImV4cCI6MjA5NjYxNjY2M30.g52ABcgrte5mZWWeD90fDj0tPeOM5E4XZMZd0l2vnI8";

async function sb(path) {
  const res = await fetch(`${SUPA_URL}${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

exports.handler = async () => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache"
  };

  try {
    // Obtener todos los perfumes
    const perfumes = await sb("/rest/v1/perfumes?select=id,nombre,genero,ml,precio,notas,receta");

    // Obtener lotes producidos (total producido por perfume)
    const lotes = await sb("/rest/v1/lotes?select=perfume_id,cantidad");

    // Obtener ventas individuales
    const ventas = await sb("/rest/v1/ventas?select=perfume_id,cantidad");

    // Obtener ventas de paquetes
    const ventasPaq = await sb("/rest/v1/ventas_paquete?select=items");

    // Obtener ajustes de inventario
    const ajustes = await sb("/rest/v1/ajustes_inventario?select=perfume_id,tipo,cantidad,created_at&order=created_at.asc");

    // Calcular stock real por perfume (misma lógica que el sistema)
    const stockMap = {};
    perfumes.forEach(p => { stockMap[p.id] = 0; });

    // Sumar producción
    lotes.forEach(l => {
      if (stockMap[l.perfume_id] !== undefined)
        stockMap[l.perfume_id] += parseInt(l.cantidad) || 0;
    });

    // Restar ventas individuales
    ventas.forEach(v => {
      if (stockMap[v.perfume_id] !== undefined)
        stockMap[v.perfume_id] -= parseInt(v.cantidad) || 0;
    });

    // Restar ventas de paquetes
    ventasPaq.forEach(vp => {
      (vp.items || []).forEach(item => {
        if (stockMap[item.pfId] !== undefined)
          stockMap[item.pfId] -= parseInt(item.qty) || 0;
      });
    });

    // Aplicar ajustes de inventario en orden cronológico
    const ajustesPorPerfume = {};
    ajustes.forEach(a => {
      if (!ajustesPorPerfume[a.perfume_id]) ajustesPorPerfume[a.perfume_id] = [];
      ajustesPorPerfume[a.perfume_id].push(a);
    });

    Object.entries(ajustesPorPerfume).forEach(([pid, ajs]) => {
      const lastManual = [...ajs].reverse().find(a => a.tipo === "manual");
      if (lastManual) {
        const idx = ajs.indexOf(lastManual);
        let s = parseFloat(lastManual.cantidad) || 0;
        ajs.slice(idx + 1).forEach(a => {
          if (a.tipo === "entrada") s += parseFloat(a.cantidad) || 0;
          else if (a.tipo === "salida") s -= parseFloat(a.cantidad) || 0;
        });
        stockMap[pid] = Math.max(0, s);
      } else {
        ajs.forEach(a => {
          if (a.tipo === "entrada") stockMap[pid] = (stockMap[pid] || 0) + (parseFloat(a.cantidad) || 0);
          else if (a.tipo === "salida") stockMap[pid] = (stockMap[pid] || 0) - (parseFloat(a.cantidad) || 0);
        });
      }
    });

    // Construir respuesta con stock real
    const result = perfumes.map(p => ({
      id: p.id,
      nombre: p.nombre,
      genero: p.genero,
      ml: p.ml,
      precio: parseFloat(p.precio) || 250,
      notas: p.notas,
      receta: p.receta || [],
      stock: Math.max(0, stockMap[p.id] || 0),
      disponible: Math.max(0, stockMap[p.id] || 0) > 0
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ perfumes: result, timestamp: new Date().toISOString() })
    };

  } catch (err) {
    console.error("Error en stock:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
