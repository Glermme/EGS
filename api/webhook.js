// ================================================================
// api/webhook.js — Recebe notificações automáticas da e.Rede
// ================================================================
// Configure a URL do webhook no Portal da Rede:
//   https://seudominio.com.br/api/webhook
// ================================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const event = req.body;

    console.log("Webhook Rede recebido:", JSON.stringify(event, null, 2));

    const { tid, returnCode, amount, kind, reference } = event;

    const approved = returnCode === "00";

    // ── Aqui você pode adicionar sua lógica de negócio ──────────
    // Exemplos:
    //   - Salvar pedido em banco de dados
    //   - Enviar e-mail de confirmação para o cliente
    //   - Atualizar estoque
    //   - Notificar via WhatsApp
    //
    // Por enquanto apenas loga o evento:
    if (approved) {
      console.log(`✅ Pagamento APROVADO — TID: ${tid} | Valor: R$${(amount/100).toFixed(2)} | Ref: ${reference}`);
    } else {
      console.log(`❌ Pagamento RECUSADO — TID: ${tid} | Código: ${returnCode}`);
    }
    // ────────────────────────────────────────────────────────────

    // Sempre responde 200 para a Rede saber que recebeu
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("Erro webhook:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
}
