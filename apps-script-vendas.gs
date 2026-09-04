/**
 * Código do Google Apps Script para receber, em tempo real, as vendas
 * registradas no venda-controlados.html e gravá-las numa Planilha
 * Google — pra uma segunda pessoa acompanhar ao vivo e ir copiando
 * pro SNGPC.
 *
 * Também recebe as edições feitas depois (ex: corrigir uma validade
 * digitada errada): em vez de duplicar a linha, ele encontra a linha
 * pelo ID do item e atualiza os dados nela.
 *
 * COMO CONFIGURAR (uma vez só):
 *
 * 1. Crie uma Planilha Google nova (sheets.new), com o nome que quiser
 *    (ex: "Vendas de Controlados").
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
 * 7. Copie a URL que aparece (termina em "/exec"). É essa URL que fica
 *    guardada como padrão dentro do venda-controlados.js (constante
 *    URL_NUVEM_PADRAO) — só precisa colar manualmente ali se um dia
 *    trocar de planilha (ex: se a planilha atual for apagada de novo).
 *
 * 8. Deixe essa planilha aberta no PC (ou no Google Sheets do celular/
 *    tablet de quem for copiar pro SNGPC) — as linhas vão aparecer e se
 *    atualizar sozinhas conforme o balconista for registrando as vendas.
 *
 * Sempre que o código deste arquivo for alterado, é preciso fazer uma
 * nova implantação (Implantar → Gerenciar implantações → editar → Nova
 * versão) para as mudanças valerem na URL já publicada. Colunas novas
 * são adicionadas sozinhas ao cabeçalho na primeira chamada após a nova
 * implantação, sem mexer nas linhas já existentes.
 */

var CABECALHO_ = [
  "Data/Hora", "Registro MS", "Descrição", "Apresentação",
  "Lote", "Validade", "Quantidade", "Código de barras",
  "ID", "Atualizado em", "Vendedor", "Cliente", "RG", "Endereço"
];

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    var aba = abaVenda_();

    var camposMeio = [
      dados.registroMs || "",
      dados.descricao || "",
      dados.apresentacao || "",
      dados.lote || "",
      dados.validade || "",
      dados.quantidade || "",
      dados.codigo || ""
    ];

    var camposFinais = [
      dados.vendedor || "",
      dados.clienteNome || "",
      dados.clienteRg || "",
      dados.clienteEndereco || ""
    ];

    var linha = dados.id ? encontrarLinhaPorId_(aba, dados.id) : 0;

    if (linha) {
      // Já existe uma linha com esse ID (venda editada depois de registrada):
      // sobrescreve os dados nela em vez de duplicar.
      aba.getRange(linha, 2, 1, 7).setValues([camposMeio]);   // B..H
      aba.getRange(linha, 10).setValue(new Date());            // J = Atualizado em
      aba.getRange(linha, 11, 1, 4).setValues([camposFinais]); // K..N = Vendedor/Cliente/RG/Endereço
    } else {
      // Venda nova (ou o ID não foi encontrado, ex: linha apagada manualmente
      // na planilha) — adiciona como linha nova.
      aba.appendRow(
        [new Date()].concat(camposMeio, [dados.id || "", ""], camposFinais)
      );
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

function abaVenda_() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName("Vendas");

  if (!aba) {
    aba = planilha.insertSheet("Vendas");
    aba.appendRow(CABECALHO_);
    aba.setFrozenRows(1);
    return aba;
  }

  // Completa no cabeçalho as colunas que ainda não existem (ex: se a
  // planilha foi criada com uma versão anterior deste script) sem mexer
  // nas colunas nem nas linhas já existentes.
  var cabecalhoAtual = aba.getRange(1, 1, 1, CABECALHO_.length).getValues()[0];
  for (var i = 0; i < CABECALHO_.length; i++) {
    if (cabecalhoAtual[i] !== CABECALHO_[i]) {
      aba.getRange(1, i + 1).setValue(CABECALHO_[i]);
    }
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
