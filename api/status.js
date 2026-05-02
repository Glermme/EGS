// ================================================================
// api/status.js — Consulta status de uma transação e.Rede
// ================================================================
// Uso: GET /api/status?tid=XXXX
// ================================================================

const REDE_PV      = process.env.REDE_PV    || "48087130";
const REDE_TOKEN   = process.env.REDE_TOKEN || "f2e49b858d864e30aacbdefa6d20eb93";
const REDE_SANDBOX = process.env.REDE_SANDBOX !== "false";

const REDE_URL  = REDE_SANDBOX
  ? "https://sandbox-erede.useredecloud.com.br"
  : "https://api.userede.com.br";

const REDE_AUTH = Buffer.from(`${REDE_PV}:${REDE_TOKEN}`).toString("base64");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { tid } = req.query;

  if (!tid) {
    return res.status(400).json({ error: "TID não informado" });
  }

  try {
    const response = await fetch(`${REDE_URL}/v1/transactions/${tid}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${REDE_AUTH}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: "Transação não encontrada", details: data });
    }

    return res.status(200).json({
      tid: data.tid,
      nsu: data.nsu,
      status: data.returnCode === "00" ? "approved" : "declined",
      returnCode: data.returnCode,
      returnMessage: data.returnMessage,
      amount: data.amount,
      installments: data.installments,
      authorizationCode: data.authorizationCode,
      datetime: data.dateTime,
    });

  } catch (err) {
    console.error("Erro status:", err);
    return res.status(500).json({ error: "Erro interno", message: err.message });
  }
}
