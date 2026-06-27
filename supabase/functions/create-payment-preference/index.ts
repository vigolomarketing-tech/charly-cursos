import { createClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;
type PlanCode = "pack_completo" | "personal_trainer" | "nutricion" | "funcional_hiit" | "musculacion";
type PriceOption = "pago_unico" | "tres_cuotas" | "seis_cuotas";

type CheckoutOption = {
  title: string;
  description: string;
  unit_price: number;
  installments?: number;
};

const ACCESS_TOKEN = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SITE_URL = Deno.env.get("PUBLIC_SITE_URL") || "https://fitnesstrainingzone.com";
const WEBHOOK_URL = Deno.env.get("MERCADO_PAGO_WEBHOOK_URL")
  || `${SUPABASE_URL}/functions/v1/mercado-pago-webhook`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CHECKOUT_OPTIONS: Record<PlanCode, Partial<Record<PriceOption, CheckoutOption>>> = {
  personal_trainer: {
    pago_unico: {
      title: "Personal Trainer",
      description: "Curso completo Personal Trainer - pago unico",
      unit_price: 68000,
    },
    tres_cuotas: {
      title: "Personal Trainer",
      description: "Curso completo Personal Trainer - 3 cuotas sin interes",
      unit_price: 76000,
      installments: 3,
    },
    seis_cuotas: {
      title: "Personal Trainer",
      description: "Curso completo Personal Trainer - 6 cuotas sin interes",
      unit_price: 86000,
      installments: 6,
    },
  },
  nutricion: {
    pago_unico: {
      title: "Nutricion deportiva",
      description: "Curso completo Nutricion deportiva",
      unit_price: 34000,
    },
  },
  funcional_hiit: {
    pago_unico: {
      title: "Funcional & HIIT",
      description: "Curso completo Funcional & HIIT",
      unit_price: 34000,
    },
  },
  musculacion: {
    pago_unico: {
      title: "Musculacion",
      description: "Curso completo Musculacion",
      unit_price: 34000,
    },
  },
  pack_completo: {
    pago_unico: {
      title: "Pack Completo FTZ",
      description: "Acceso a Personal Trainer, Nutricion, Funcional & HIIT y Musculacion",
      unit_price: 136000,
    },
    tres_cuotas: {
      title: "Pack Completo FTZ",
      description: "Pack Completo FTZ - 3 cuotas sin interes",
      unit_price: 152000,
      installments: 3,
    },
    seis_cuotas: {
      title: "Pack Completo FTZ",
      description: "Pack Completo FTZ - 6 cuotas sin interes",
      unit_price: 172000,
      installments: 6,
    },
  },
};

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CHECKOUT_OPTIONS, value);
}

function isPriceOption(value: unknown): value is PriceOption {
  return value === "pago_unico" || value === "tres_cuotas" || value === "seis_cuotas";
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function getAuthenticatedUserEmail(req: Request): Promise<string> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Faltan variables de entorno de Supabase");
  }

  const token = readBearerToken(req);
  if (!token) {
    throw new Error("Tenes que iniciar sesion antes de pagar");
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    throw new Error("No se pudo validar la sesion del alumno");
  }

  return data.user.email.toLowerCase();
}

async function createMercadoPagoPreference(plan: PlanCode, priceOption: PriceOption, email: string) {
  if (!ACCESS_TOKEN) {
    throw new Error("Falta MERCADO_PAGO_ACCESS_TOKEN");
  }

  const checkout = CHECKOUT_OPTIONS[plan][priceOption];
  if (!checkout) {
    throw new Error("La opcion de pago no esta disponible para este plan");
  }

  const preference = {
    items: [
      {
        id: `${plan}_${priceOption}`,
        title: checkout.title,
        description: checkout.description,
        quantity: 1,
        currency_id: "ARS",
        unit_price: checkout.unit_price,
      },
    ],
    payer: {
      email,
    },
    external_reference: plan,
    metadata: {
      plan,
      user_email: email,
      price_option: priceOption,
    },
    notification_url: WEBHOOK_URL,
    back_urls: {
      success: `${SITE_URL}/campus.html`,
      pending: `${SITE_URL}/campus.html`,
      failure: `${SITE_URL}/planes.html`,
    },
    auto_return: "approved",
    statement_descriptor: "FTZ CAMPUS",
    payment_methods: checkout.installments
      ? { installments: checkout.installments }
      : undefined,
  };

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preference),
  });

  const data = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok) {
    throw new Error(String(data?.message || `Mercado Pago respondio ${response.status}`));
  }

  return data || {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Metodo no permitido" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({})) as JsonRecord;
    const plan = body.plan;
    const priceOption = body.price_option || "pago_unico";
    const email = body.email;

    if (!isPlanCode(plan)) {
      return jsonResponse({ ok: false, error: "Plan invalido" }, 400);
    }

    if (!isPriceOption(priceOption)) {
      return jsonResponse({ ok: false, error: "Opcion de pago invalida" }, 400);
    }

    if (!isEmail(email)) {
      return jsonResponse({ ok: false, error: "Email invalido" }, 400);
    }

    const authenticatedEmail = await getAuthenticatedUserEmail(req);
    if (authenticatedEmail !== email.toLowerCase()) {
      return jsonResponse({ ok: false, error: "El email no coincide con la sesion activa" }, 403);
    }

    const preference = await createMercadoPagoPreference(plan, priceOption, authenticatedEmail);

    return jsonResponse({
      ok: true,
      preference_id: preference.id || null,
      init_point: preference.init_point || preference.sandbox_init_point || null,
    });
  } catch (error) {
    console.error("Error creando preferencia Mercado Pago", {
      message: error instanceof Error ? error.message : String(error),
    });

    const message = error instanceof Error ? error.message : "Error desconocido";
    const status = message.includes("sesion") || message.includes("iniciar sesion") ? 401 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
});
