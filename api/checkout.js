// ================================================================
// api/checkout-getnet.js
// ================================================================

const GETNET_CLIENT_ID     = process.env.GETNET_CLIENT_ID;
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET;
const GETNET_SELLER_ID     = process.env.GETNET_SELLER_ID;
const SUPABASE_URL         = process.env.SUPABASE_URL || "";
const SUPABASE_KEY         = process.env.SUPABASE_KEY || "";
const GETNET_URL           = "https://api.getnet.com.br";

/* ── Supabase insert ─────────────────────────── */
async function insertOrder(row) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.error("Supabase insert erro:", await res.text());
    else console.log("Supabase insert OK:", row.tid);
  } catch (err) {
    console.error("Supabase insert exception:", err.message);
  }
}

/* ── Token ───────────────────────────────────── */
async function getToken() {
  const credentials = Buffer.from(`${GETNET_CLIENT_ID}:${GETNET_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${GETNET_URL}/auth/oauth/v2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=oob",
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Token falhou: " + JSON.stringify(data));
  return data.access_token;
}

/* ── Tokeniza cartão ─────────────────────────── */
async function tokenizeCard(token, cardNumber, customerId) {
  const clean = String(cardNumber).replace(/\D/g, "");
  if (!clean || clean.length < 13) throw new Error("Número de cartão inválido");
  const res = await fetch(`${GETNET_URL}/v1/tokens/card`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "x-seller-id": GETNET_SELLER_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ card_number: clean, customer_id: customerId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Tokenização falhou: " + JSON.stringify(data));
  return data.number_token;
}

/* ── Fetch seguro ────────────────────────────── */
async function gFetch(url, opts) {
  const res = await fetch(url, opts);
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { throw new Error("Resposta não-JSON: " + txt.slice(0, 200)); }
  console.log("GETNET RESPONSE:", JSON.stringify(data));
  return { res, data };
}

/* ── Detecta bandeira ────────────────────────── */
function detectBrand(num) {
  const n = String(num).replace(/\D/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^5[1-5]/.test(n)) return "Mastercard";
  if (/^2(2[2-9][1-9]|[3-6]\d{2}|7[01]\d|720)\d/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^(6362|438935|504175|451416|636297|5067|4576|4011)/.test(n)) return "Elo";
  if (/^606282/.test(n)) return "Hipercard";
  return "Mastercard";
}

/* ── Handler ─────────────────────────────────── */
module.exports = async function handler(req, res) {
  try {
    console.log("=== CHECKOUT START ===");
    console.log("BODY:", JSON.stringify(req.body));

    const {
      kind, amount, installments,
      cardNumber, cardExpiry, cardCvv, cardHolder,
      customerName, customerCpf, customerEmail, customerPhone,
      addrStreet, addrNumber, addrComplement, addrDistrict, addrCity, addrState, addrZip,
      reference, items,
    } = req.body;

    // Validações
    if (!["credit","debit","pix"].includes(kind)) return res.status(400).json({ error: "Tipo inválido" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Valor inválido" });
    if (!customerCpf) return res.status(400).json({ error: "CPF não informado" });
    if (!customerName) return res.status(400).json({ error: "Nome não informado" });
    if (kind !== "pix") {
      if (!cardNumber || String(cardNumber).replace(/\D/g,"").length < 13) return res.status(400).json({ error: "Número de cartão inválido" });
      if (!cardExpiry || !cardExpiry.includes("/")) return res.status(400).json({ error: "Validade inválida" });
      if (!cardCvv) return res.status(400).json({ error: "CVV não informado" });
      if (!cardHolder || cardHolder.trim().length < 3) return res.status(400).json({ error: "Nome do titular inválido" });
    }

    const token      = await getToken();
    const customerId = "customer-" + String(customerCpf).replace(/\D/g, "");
    const orderId    = reference || `EGS-${Date.now()}`;
    const amountNum  = Number(amount);
    const nameParts  = customerName.trim().split(" ");

    const customerObj = {
      customer_id:     customerId,
      first_name:      nameParts[0],
      last_name:       nameParts.slice(1).join(" ") || ".",
      name:            customerName.trim(),
      email:           customerEmail,
      document_type:   "CPF",
      document_number: String(customerCpf).replace(/\D/g, ""),
      phone_number:    String(customerPhone).replace(/\D/g, ""),
      billing_address: {
        street:      addrStreet     || "",
        number:      addrNumber     || "",
        complement:  addrComplement || "",
        district:    addrDistrict   || "",
        city:        addrCity       || "",
        state:       addrState      || "",
        country:     "Brasil",
        postal_code: String(addrZip || "").replace(/\D/g, ""),
      },
    };

    const deviceObj = { device_id: "device-" + Date.now(), ip_address: req.headers["x-forwarded-for"] || "127.0.0.1" };
    const orderObj  = { order_id: orderId, sales_tax: 0, product_type: "service" };

    const baseRow = {
      reference: orderId, kind, amount: amountNum,
      installments: Number(installments) || 1,
      customer_name: customerName, customer_email: customerEmail,
      customer_cpf: String(customerCpf).replace(/\D/g, ""),
      items: items || "", status: "pending",
    };

    /* PIX */
    if (kind === "pix") {
      const pixBody = {
        seller_id: GETNET_SELLER_ID, amount: amountNum, currency: "BRL",
        order: orderObj, customer: customerObj, device: deviceObj,
        pix: { expiration_time: 3600, additional_data: [{ name: "Loja", value: "EGS Materiais" }] },
      };
      console.log("PIX BODY:", JSON.stringify(pixBody));
      const { data } = await gFetch(`${GETNET_URL}/v1/payments/qrcode/pix`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-seller-id": GETNET_SELLER_ID, "Content-Type": "application/json" },
        body: JSON.stringify(pixBody),
      });
      await insertOrder({ ...baseRow, tid: data.payment_id || null });
      return res.status(200).json(data);
    }

    /* Cartão */
    const [month, yearRaw] = cardExpiry.split("/");
    const year        = String(yearRaw).trim().slice(-2);
    const numberToken = await tokenizeCard(token, cardNumber, customerId);
    const cardHeaders = { Authorization: `Bearer ${token}`, "x-seller-id": GETNET_SELLER_ID, "Content-Type": "application/json" };
    const cardObj = {
      number_token: numberToken, cardholder_name: cardHolder.trim(),
      security_code: String(cardCvv).replace(/\D/g, ""), brand: detectBrand(cardNumber),
      expiration_month: month.trim(), expiration_year: year,
    };

    /* Crédito */
    if (kind === "credit") {
      const body = {
        seller_id: GETNET_SELLER_ID, amount: amountNum, currency: "BRL",
        order: orderObj, customer: customerObj, device: deviceObj,
        credit: {
          delayed: false, authenticated: false, pre_authorization: false, save_card_data: false,
          transaction_type: "FULL", number_installments: Number(installments) || 1,
          soft_descriptor: "EGS MATERIAIS", dynamic_mcc: 1799, card: cardObj,
        },
      };
      console.log("CREDIT BODY:", JSON.stringify(body));
      const { data } = await gFetch(`${GETNET_URL}/v1/payments/credit`, { method:"POST", headers:cardHeaders, body:JSON.stringify(body) });
      const status = data.status === "APPROVED" ? "approved" : "pending";
      await insertOrder({ ...baseRow, tid: data.payment_id||null, status, auth_code: data.credit?.authorization_code||"", return_code: data.credit?.terminal_nsu||"" });
      return res.status(200).json(data);
    }

    /* Débito */
    if (kind === "debit") {
      const body = {
        seller_id: GETNET_SELLER_ID, amount: amountNum, currency: "BRL",
        order: orderObj, customer: customerObj, device: deviceObj,
        debit: { authenticated: false, transaction_type: "FULL", soft_descriptor: "EGS MATERIAIS", card: cardObj },
      };
      console.log("DEBIT BODY:", JSON.stringify(body));
      const { data } = await gFetch(`${GETNET_URL}/v1/payments/debit`, { method:"POST", headers:cardHeaders, body:JSON.stringify(body) });
      const status = data.status === "APPROVED" ? "approved" : "pending";
      await insertOrder({ ...baseRow, tid: data.payment_id||null, status, auth_code: data.debit?.authorization_code||"", return_code: data.debit?.terminal_nsu||"" });
      return res.status(200).json(data);
    }

  } catch (err) {
    console.error("[checkout-getnet] Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
