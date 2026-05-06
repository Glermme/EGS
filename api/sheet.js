// ================================================================
// api/sheet.js — Proxy da planilha Google Sheets (sem cache)
// ================================================================
// Adicione no Vercel → Settings → Environment Variables:
//   SHEET_URL = https://docs.google.com/spreadsheets/d/SEU_ID/pub?output=csv
// ================================================================

module.exports = async function handler(req, res) {
  const url = process.env.SHEET_URL;

  if (!url) {
    return res.status(500).json({ error: "SHEET_URL não configurada nas variáveis de ambiente do Vercel" });
  }

  try {
    const response = await fetch(url, {
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
    });

    if (!response.ok) {
      throw new Error(`Google Sheets retornou HTTP ${response.status}`);
    }

    const csv = await response.text();

    // Retorna o CSV sem cache nenhum
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(csv);
  } catch (err) {
    console.error("[sheet] Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
