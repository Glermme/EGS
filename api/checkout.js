// ================================================================
// api/checkout.js — Processa pagamentos via e.Rede
// ================================================================
// CREDENCIAIS — quando for para produção, troque os valores
// das variáveis de ambiente no Vercel:
//   Settings → Environment Variables
//   REDE_PV       → número do estabelecimento
//   REDE_TOKEN    → token de autenticação
//   REDE_SANDBOX  → "true" em teste, "false" em produção
//   SUPABASE_URL  → https://XXXX.supabase.co         ← NOVO
//   SUPABASE_KEY  → sua service_role key do Supabase  ← NOVO
// ================================================================

const REDE_PV      = process.env.REDE_PV    || "48087130";
const REDE_TOKEN   = process.env.REDE_TOKEN || "f2e49b858d864e30aacbdefa6d20eb93";
const REDE_SANDBOX = process.env.REDE_SANDBOX !== "false"; // true = sandbox

const REDE_URL = REDE_SANDBOX
  ? "https://sandbox-erede.useredecloud.com.br"
  : "https://api.userede.com.br";

// credencial base64 para autenticação Basic
const REDE_AUTH = Buffer.from(`${REDE_PV}:${REDE_TOKEN}`).toString("base64");

// ── Supabase ─────────────────────────────────────────────────────
// Use a service_role key aqui (server-side, nunca exposta ao cliente)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || ""; // service_role key

/**
 * Salva o pedido na tabela `pedidos` do Supabase.
 * Falha silenciosa: se o Supabase não estiver configurado ou der erro,
 * o pagamento já foi aprovado — o cliente não é prejudicado.
 */
async function saveOrder(orderData) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return; // não configurado, pula

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(orderData),
    });
  } catch (err) {
    // log sem quebrar o fluxo do checkout
    console.error("[Supabase] Erro ao salvar pedido:", err.message);
  }
}

// ================================================================

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const {
      // dados do pedido
      amount,       // valor em centavos (ex: R$42,90 = 4290)
      installments, // parcelas (1 para à vista)
      // dados do cartão
      cardNumber,
      cardExpiry,   // "MM/YYYY"
      cardCvv,
      cardHolder,
      // dados do cliente
      customerName,
      customerCpf,
      customerEmail,
      customerPhone,
      // endereço / cidade
      city,
      // itens do carrinho (array de { name, qty, price })
      items,
      // tipo de pagamento
      kind,         // "credit", "debit" ou "pix"
      // referência interna
      reference,    // ex: "PEDIDO-001"
    } = req.body;

    // ── PIX ──────────────────────────────────────────────────────
    if (kind === "pix") {
      const pixBody = {
        amount: Number(amount),
        expiresIn: 3600, // expira em 1 hora
        referenceNumber: reference || `EGS-${Date.now()}`,
      };

      const pixRes = await fetch(`${REDE_URL}/v1/transactions/pix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${REDE_AUTH}`,
        },
        body: JSON.stringify(pixBody),
      });

      const pixData = await pixRes.json();

      if (!pixRes.ok) {
        return res.status(400).json({
          error: "Erro ao gerar Pix",
          details: pixData,
        });
      }

      const pixApproved = pixData.returnCode === "00";

      // ── Salva no Supabase (Pix gerado com sucesso) ────────────
      // Para Pix o status inicial é sempre "aguardando" —
      // a confirmação de pagamento vem via webhook da e.Rede.
      if (pixApproved) {
        await saveOrder({
          id:             reference || `EGS-${Date.now()}`,
          customer_name:  customerName  || null,
          customer_cpf:   customerCpf   || null,
          customer_email: customerEmail || null,
          customer_phone: customerPhone || null,
          city:           city          || null,
          payment_method: "pix",
          status:         "aguardando",            // aguarda confirmação do Pix
          total:          (Number(amount) / 100).toFixed(2),
          tid:            pixData.tid || null,
          items:          items || [],
          created_at:     new Date().toISOString(),
        });
      }

      return res.status(200).json({
        kind: "pix",
        tid: pixData.tid,
        qrCode: pixData.pix?.qrCode,
        qrCodeImage: pixData.pix?.qrCodeImage,
        expiresAt: pixData.pix?.expiresAt,
        status: pixApproved ? "pending" : "error",
      });
    }

    // ── CARTÃO CRÉDITO / DÉBITO ──────────────────────────────────
    const [expMonth, expYear] = (cardExpiry || "").split("/");

    const cardBody = {
      kind: kind === "debit" ? "debit" : "credit",
      reference: reference || `EGS-${Date.now()}`,
      amount: Number(amount),
      installments: Number(installments) || 1,
      cardholderName: cardHolder,
      cardNumber: cardNumber.replace(/\s/g, ""),
      expirationMonth: expMonth,
      expirationYear: expYear,
      securityCode: cardCvv,
      softDescriptor: "EGS MATERIAIS",
      capture: true, // captura automática
    };

    const cardRes = await fetch(`${REDE_URL}/v1/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${REDE_AUTH}`,
      },
      body: JSON.stringify(cardBody),
    });

    const cardData = await cardRes.json();

    if (!cardRes.ok) {
      return res.status(400).json({
        error: "Erro ao processar cartão",
        details: cardData,
      });
    }

    // returnCode "00" = aprovado
    const approved = cardData.returnCode === "00";

    // ── Salva no Supabase (apenas se aprovado) ────────────────────
    if (approved) {
      await saveOrder({
        id:             reference || `EGS-${Date.now()}`,
        customer_name:  customerName  || null,
        customer_cpf:   customerCpf   || null,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        city:           city          || null,
        payment_method: kind === "debit" ? "debito" : "credito",
        status:         "confirmado",              // cartão aprovado = confirmado
        total:          (Number(amount) / 100).toFixed(2),
        installments:   Number(installments) || 1,
        tid:            cardData.tid              || null,
        nsu:            cardData.nsu              || null,
        auth_code: cardData.authorizationCode || null,
        items:          items || [],
        created_at:     new Date().toISOString(),
      });
    }

    return res.status(200).json({
      kind,
      tid: cardData.tid,
      nsu: cardData.nsu,
      authorizationCode: cardData.authorizationCode,
      status: approved ? "approved" : "declined",
      returnCode: cardData.returnCode,
      returnMessage: cardData.returnMessage,
    });

  } catch (err) {
    console.error("Erro checkout:", err);
    return res.status(500).json({ error: "Erro interno", message: err.message });
  }
}
