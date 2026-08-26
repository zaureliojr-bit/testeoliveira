/**
 * Código do Google Apps Script para receber, em tempo real, os itens
 * escaneados no Painel de Conformidade (conformidade.html) e gravá-los
 * como novas linhas numa Planilha Google — pra uma segunda pessoa
 * acompanhar ao vivo e ir copiando pro SNGPC.
 *
 * COMO CONFIGURAR (uma vez só):
 *
 * 1. Crie uma Planilha Google nova (sheets.new), com o nome que quiser
 *    (ex: "Balanço de Controlados").
 *
 * 2. No menu da planilha: Extensões → Apps Script.
 *
 * 3. Apague o conteúdo padrão do arquivo "Código.gs" e cole TODO o
 *    conteúdo deste arquivo no lugar.
 *
 * 4. Salve (ícone de disquete ou Ctrl+S).
 *
 * 5. Clique em "Implantar" (Deploy) → "Nova implantação" (New deployment).
 *    - Tipo: "App da Web" (Web app)
 *    - Executar como: "Eu" (seu e-mail)
 *    - Quem pode acessar: "Qualquer pessoa" (Anyone)
 *      (precisa ser "Qualquer pessoa" para o celular conseguir enviar
 *      os dados sem precisar fazer login com conta Google)
 *
 * 6. Clique em "Implantar". Ele vai pedir autorização — aceite (é a sua
 *    própria planilha, a permissão é só pra ela mesma).
 *
 * 7. Copie a URL que aparece (termina em "/exec"). Essa é a URL que você
 *    vai colar no Painel de Conformidade, na seção "☁️ Sincronização".
 *
 * 8. Deixe essa planilha aberta no PC (ou no Google Sheets do celular/
 *    tablet de quem for copiar pro SNGPC) — as linhas vão aparecer
 *    sozinhas conforme o celular do estoque for escaneando e salvando.
 *
 * Sempre que o código deste arquivo for alterado, é preciso fazer uma
 * nova implantação (Implantar → Gerenciar implantações → editar → Nova
 * versão) para as mudanças valerem na URL já publicada.
 */

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    var aba = abaBalanco_();

    aba.appendRow([
      new Date(),
      dados.registroMs || "",
      dados.descricao || "",
      dados.apresentacao || "",
      dados.lote || "",
      dados.validade || "",
      dados.quantidade || "",
      dados.codigo || ""
    ]);

    return respostaJson_({ ok: true });
  } catch (err) {
    return respostaJson_({ ok: false, erro: String(err) });
  }
}

function doGet(e) {
  // Usado só pra testar se a URL está no ar (o Painel de Conformidade
  // chama isso ao salvar a configuração, pra confirmar que deu certo).
  return respostaJson_({ ok: true, status: "online" });
}

function abaBalanco_() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName("Balanço");

  if (!aba) {
    aba = planilha.insertSheet("Balanço");
    aba.appendRow([
      "Data/Hora", "Registro MS", "Descrição", "Apresentação",
      "Lote", "Validade", "Quantidade", "Código de barras"
    ]);
    aba.setFrozenRows(1);
  }

  return aba;
}

function respostaJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
