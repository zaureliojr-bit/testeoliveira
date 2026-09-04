/**
 * Código do Google Apps Script para receber, em tempo real, os itens
 * escaneados nos painéis (conformidade.html, balanco-medicamentos.html
 * e venda-controlados.html) e gravá-los numa Planilha Google — pra uma
 * segunda pessoa acompanhar ao vivo e ir copiando pro SNGPC.
 *
 * Também recebe as edições feitas depois (ex: corrigir uma validade
 * digitada errada): em vez de duplicar a linha, ele encontra a linha
 * pelo ID do item e atualiza os dados nela.
 *
 * Esse mesmo código serve pra qualquer um dos painéis — só use uma
 * Planilha Google (e uma implantação) DIFERENTE para cada painel, pra
 * não misturar contagem física, material geral e vendas na mesma lista.
 * Se quiser, mude o nome abaixo em NOME_ABA_ pra deixar mais claro qual
 * é qual (ex: "Vendas" na planilha do venda-controlados.html).
 *
 * COMO CONFIGURAR (uma vez pra cada painel/planilha):
 *
 * 1. Crie uma Planilha Google nova (sheets.new), com o nome que quiser
 *    (ex: "Balanço de Controlados" ou "Vendas de Controlados").
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
 *    vai colar no painel, na seção "☁️ Sincronização".
 *
 * 8. Deixe essa planilha aberta no PC (ou no Google Sheets do celular/
 *    tablet de quem for copiar pro SNGPC) — as linhas vão aparecer e se
 *    atualizar sozinhas conforme o celular do estoque for escaneando,
 *    salvando e corrigindo itens.
 *
 * Sempre que o código deste arquivo for alterado, é preciso fazer uma
 * nova implantação (Implantar → Gerenciar implantações → editar → Nova
 * versão) para as mudanças valerem na URL já publicada. Se você já tinha
 * uma versão anterior (sem edição) implantada, é só colar este código
 * por cima e implantar de novo — o cabeçalho da planilha se atualiza
 * sozinho, sem mexer nas linhas que já existem.
 */

var NOME_ABA_ = "Balanço"; // pode renomear (ex: "Vendas") antes de implantar numa planilha nova

var CABECALHO_ = [
  "Data/Hora", "Registro MS", "Descrição", "Apresentação",
  "Lote", "Validade", "Quantidade", "Código de barras",
  "ID", "Atualizado em"
];

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    var aba = abaBalanco_();

    var camposMeio = [
      dados.registroMs || "",
      dados.descricao || "",
      dados.apresentacao || "",
      dados.lote || "",
      dados.validade || "",
      dados.quantidade || "",
      dados.codigo || ""
    ];

    var linha = dados.id ? encontrarLinhaPorId_(aba, dados.id) : 0;

    if (linha) {
      // Já existe uma linha com esse ID (item editado depois de salvo):
      // sobrescreve os dados nela em vez de duplicar.
      aba.getRange(linha, 2, 1, 7).setValues([camposMeio]);
      aba.getRange(linha, 10).setValue(new Date());
    } else {
      // Item novo (ou o ID não foi encontrado, ex: linha apagada manualmente
      // na planilha) — adiciona como linha nova.
      aba.appendRow([new Date()].concat(camposMeio, [dados.id || "", ""]));
    }

    return respostaJson_({ ok: true, atualizado: !!linha });
  } catch (err) {
    return respostaJson_({ ok: false, erro: String(err) });
  }
}

function doGet(e) {
  // Usado só pra testar se a URL está no ar (o painel chama isso ao
  // salvar a configuração, pra confirmar que deu certo).
  return respostaJson_({ ok: true, status: "online" });
}

function abaBalanco_() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName(NOME_ABA_);

  if (!aba) {
    aba = planilha.insertSheet(NOME_ABA_);
    aba.appendRow(CABECALHO_);
    aba.setFrozenRows(1);
    return aba;
  }

  // Migra planilhas criadas com uma versão anterior deste script (sem as
  // colunas de ID / Atualizado em), sem mexer nas linhas já existentes.
  var cabecalhoAtual = aba.getRange(1, 1, 1, CABECALHO_.length).getValues()[0];
  if (cabecalhoAtual[8] !== CABECALHO_[8] || cabecalhoAtual[9] !== CABECALHO_[9]) {
    aba.getRange(1, 9, 1, 2).setValues([[CABECALHO_[8], CABECALHO_[9]]]);
  }

  return aba;
}

function encontrarLinhaPorId_(aba, id) {
  var ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return 0;

  var idsColuna = aba.getRange(2, 9, ultimaLinha - 1, 1).getValues();
  for (var i = 0; i < idsColuna.length; i++) {
    if (String(idsColuna[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

function respostaJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
