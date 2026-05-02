// ================================================================
// api/checkout.js — Processa pagamentos via e.Rede
// ================================================================
// CREDENCIAIS — quando for para produção, troque os valores
// das variáveis de ambiente no Vercel:
//   Settings → Environment Variables
//   REDE_PV    → número do estabelecimento
//   REDE_TOKEN → token de autenticação
//   REDE_SANDBOX → "true" em teste, "false" em produção
// ================================================================

const REDE_PV      = process.env.REDE_PV    || "48087130";
const REDE_TOKEN   = process.env.REDE_TOKEN || "f2e49b858d864e30aacbdefa6d20eb93";
const REDE_SANDBOX = process.env.REDE_SANDBOX !== "false"; // true = sandbox

const REDE_URL = REDE_SANDBOX
  ? "https://sandbox-erede.useredecloud.com.br"
  : "https://api.userede.com.br";

// credencial base64 para autenticação Basic
const REDE_AUTH = Buffer.from(`${REDE_PV}:${REDE_TOKEN}`).toString("base64");

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

      return res.status(200).json({
        kind: "pix",
        tid: pixData.tid,
        qrCode: pixData.pix?.qrCode,
        qrCodeImage: pixData.pix?.qrCodeImage,
        expiresAt: pixData.pix?.expiresAt,
        status: pixData.returnCode === "00" ? "pending" : "error",
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
