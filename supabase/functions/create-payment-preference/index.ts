const MP_TOKEN = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");

const WEBHOOK_URL =
  "https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook";
const SITE = "https://vigolomarketing-tech.github.io/charly-cursos";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Prices defined server-side — never trust client-supplied amounts.
const PLANS: Record<string, { title: string; prices: Record<number, number> }> =
  {
    pack_completo: {
      title: "Pack Completo",
      prices: { 1: 136000, 3: 152000, 6: 172000 },
    },
    personal_trainer: {
      title: "Personal Trainer",
      prices: { 1: 68000, 3: 76000, 6: 86000 },
    },
    funcional_hiit: { title: "Funcional & HIIT", prices: { 1: 34000 } },
    musculacion: { title: "Musculación", prices: { 1: 34000 } },
    nutricion: { title: "Nutrición Deportiva", prices: { 1: 34000 } },
  };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  if (!MP_TOKEN) {
    return jsonResponse({ error: "Token de Mercado Pago no configurado" }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const { plan, installments = 1 } = body;

  const planData = PLANS[plan];
  if (!planData) {
    return jsonResponse({ error: `Plan desconocido: ${plan}` }, 400);
  }

  const qty = Number(installments);
  const unitPrice = planData.prices[qty];
  if (!unitPrice) {
    return jsonResponse(
      { error: `Cuotas no disponibles para este plan: ${installments}` },
      400,
    );
  }

  const preference: Record<string, unknown> = {
    items: [
      {
        title: planData.title,
        quantity: 1,
        unit_price: unitPrice,
        currency_id: "ARS",
      },
    ],
    external_reference: plan,
    notification_url: WEBHOOK_URL,
    back_urls: {
      success: `${SITE}/campus.html`,
      failure: `${SITE}/planes.html`,
      pending: `${SITE}/campus.html`,
    },
    auto_return: "approved",
  };

  if (qty > 1) {
    preference.installments = qty;
  }

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preference),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return jsonResponse(
      { error: data?.message || "Error creando preferencia en Mercado Pago" },
      500,
    );
  }

  return jsonResponse({ init_point: data.init_point, id: data.id });
});
