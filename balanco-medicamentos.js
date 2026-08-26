/* =========================
⚙️ CONFIG
========================= */
const HISTORICO_KEY = "balancoMedHistorico";
const URL_NUVEM_KEY = "balancoMedUrlNuvem";
const LINHAS_PARA_DETECTAR_CABECALHO = 30;

const CAMPOS_MAPEAVEIS = ["codigo", "descricao", "registro", "apresentacao", "laboratorio"];
const CAMPOS_OBRIGATORIOS = ["codigo", "descricao"];

const PALAVRAS_CHAVE = {
  codigo: ["codigo de barras", "codigo barras", "cod barras", "cod. barras", "ean", "gtin", "barras"],
  registro: ["registro ms", "registro anvisa", "registro", "reg ms", "anvisa"],
  descricao: ["descricao", "produto", "nome do produto", "nome", "medicamento"],
  apresentacao: ["apresentacao"],
  laboratorio: ["laboratorio", "fabricante"]
};

const ROTULOS_CAMPOS = {
  codigo: "Código de barras",
  descricao: "Descrição",
  registro: "Registro MS",
  apresentacao: "Apresentação",
  laboratorio: "Laboratório"
};

/* =========================
🗄️ ESTADO
========================= */
let baseImportada = null; // { ean: { registro, descricao, apresentacao, laboratorio } }
let historico = JSON.parse(localStorage.getItem(HISTORICO_KEY)) || [];
let urlNuvem = localStorage.getItem(URL_NUVEM_KEY) || "";
let leitorAtivo = null;
let ultimoCodigoLido = "";
let ultimoCodigoTimestamp = 0;

// Guardam a planilha crua enquanto o usuário confirma o mapeamento manual de colunas
let linhasPendentes = null;
let nomeArquivoPendente = "";

/* =========================
🛠️ HELPERS
========================= */
const el = id => document.getElementById(id);

let toastTimer;
function toast(msg) {
  const t = el("toast");
  if (!t) return;
  clearTimeout(toastTimer);
  t.textContent = msg;
  t.className = "toast ativo";
  toastTimer = setTimeout(() => (t.className = "toast"), 2800);
}

function apenasDigitos(s) {
  return (s || "").replace(/\D/g, "");
}

function normalizarTexto(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uppercaseLote(input) {
  const pos = input.selectionStart;
  input.value = input.value.toUpperCase();
  input.selectionStart = input.selectionEnd = pos;
}

function mascaraValidade(input) {
  let v = apenasDigitos(input.value).slice(0, 8);
  if (v.length > 4) v = v.replace(/(\d{2})(\d{2})(\d{1,4})/, "$1/$2/$3");
  else if (v.length > 2) v = v.replace(/(\d{2})(\d{1,2})/, "$1/$2");
  input.value = v;
}

function dataBrValida(str) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str || "");
  if (!m) return false;

  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  if (mes < 1 || mes > 12) return false;

  const data = new Date(ano, mes - 1, dia);
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
}

/* =========================
🚀 INIT
========================= */
document.addEventListener("DOMContentLoaded", () => {
  renderHistorico();
  iniciarConfigNuvem();
});

/* =========================
📂 IMPORTAR PLANILHA
========================= */
async function importarPlanilha(arquivo) {
  if (!arquivo) return;

  if (typeof XLSX === "undefined") {
    toast("Biblioteca de planilhas não carregou. Verifique sua conexão.");
    return;
  }

  el("statusImportacao").textContent = "Lendo planilha...";

  try {
    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

    if (!linhas.length) throw new Error("Planilha vazia");

    prepararMapeamento(linhas, arquivo.name);
  } catch (e) {
    console.error("Erro ao importar planilha", e);
    el("statusImportacao").textContent = "";
    toast("Não consegui ler essa planilha. Verifique se é um .xlsx, .xls ou .csv válido.");
  }
}

function encontrarLinhaCabecalho(linhas) {
  let melhorIndice = 0;
  let melhorPontuacao = -1;

  const limite = Math.min(linhas.length, LINHAS_PARA_DETECTAR_CABECALHO);

  for (let i = 0; i < limite; i++) {
    const linha = linhas[i] || [];
    let pontuacao = 0;

    linha.forEach(celula => {
      const texto = normalizarTexto(celula);
      if (!texto) return;
      const bate = Object.values(PALAVRAS_CHAVE).some(lista => lista.some(palavra => texto.includes(palavra)));
      if (bate) pontuacao++;
    });

    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhorIndice = i;
    }
  }

  return { indice: melhorIndice, pontuacao: melhorPontuacao };
}

function detectarMapeamento(linhaCabecalho) {
  const mapeamento = {};

  linhaCabecalho.forEach((celula, indiceColuna) => {
    const texto = normalizarTexto(celula);
    if (!texto) return;

    for (const campo of CAMPOS_MAPEAVEIS) {
      if (mapeamento[campo] != null) continue;
      if (PALAVRAS_CHAVE[campo].some(palavra => texto.includes(palavra))) {
        mapeamento[campo] = indiceColuna;
      }
    }
  });

  return mapeamento;
}

function prepararMapeamento(linhas, nomeArquivo) {
  const { indice: indiceCabecalho } = encontrarLinhaCabecalho(linhas);
  const linhaCabecalho = linhas[indiceCabecalho] || [];
  const mapeamento = detectarMapeamento(linhaCabecalho);

  const faltaObrigatorio = CAMPOS_OBRIGATORIOS.some(campo => mapeamento[campo] == null);

  if (!faltaObrigatorio) {
    construirBase(linhas, indiceCabecalho, mapeamento, nomeArquivo);
    return;
  }

  // Não deu pra detectar tudo sozinho: guarda os dados brutos e pede
  // pro usuário escolher manualmente qual coluna é qual.
  linhasPendentes = linhas;
  nomeArquivoPendente = nomeArquivo;

  preencherSelectsMapeamento(linhaCabecalho, mapeamento);
  el("mapeamentoBox").style.display = "block";
  el("statusImportacao").textContent = `"${nomeArquivo}": não identifiquei todas as colunas automaticamente — escolha abaixo.`;
  el("mapeamentoBox").scrollIntoView({ behavior: "smooth", block: "start" });
}

function preencherSelectsMapeamento(linhaCabecalho, mapeamentoSugerido) {
  const opcoes = linhaCabecalho.map((celula, i) => {
    const letra = String.fromCharCode(65 + (i % 26));
    const texto = String(celula || "").trim() || "(sem nome)";
    return `<option value="${i}">${letra}: ${texto}</option>`;
  }).join("");

  CAMPOS_MAPEAVEIS.forEach(campo => {
    const select = el(`map${campo.charAt(0).toUpperCase()}${campo.slice(1)}`);
    const opcional = CAMPOS_OBRIGATORIOS.includes(campo) ? "" : `<option value="">— não usar —</option>`;
    select.innerHTML = opcional + opcoes;
    if (mapeamentoSugerido[campo] != null) select.value = String(mapeamentoSugerido[campo]);
  });
}

function confirmarMapeamento() {
  const mapeamento = {};

  for (const campo of CAMPOS_MAPEAVEIS) {
    const select = el(`map${campo.charAt(0).toUpperCase()}${campo.slice(1)}`);
    const valor = select.value;
    if (valor !== "") mapeamento[campo] = Number(valor);
  }

  const faltaObrigatorio = CAMPOS_OBRIGATORIOS.some(campo => mapeamento[campo] == null);
  if (faltaObrigatorio) {
    const faltantes = CAMPOS_OBRIGATORIOS.filter(c => mapeamento[c] == null).map(c => ROTULOS_CAMPOS[c]);
    toast(`Selecione a coluna de: ${faltantes.join(", ")}`);
    return;
  }

  // Descobre em que linha os dados realmente começam (a primeira linha usada
  // nos selects é sempre a que foi detectada/escolhida como cabeçalho).
  const { indice: indiceCabecalho } = encontrarLinhaCabecalho(linhasPendentes);
  construirBase(linhasPendentes, indiceCabecalho, mapeamento, nomeArquivoPendente);

  el("mapeamentoBox").style.display = "none";
  linhasPendentes = null;
}

function cancelarMapeamento() {
  el("mapeamentoBox").style.display = "none";
  el("statusImportacao").textContent = "";
  el("arquivoBase").value = "";
  linhasPendentes = null;
}

function construirBase(linhas, indiceCabecalho, mapeamento, nomeArquivo) {
  const produtos = {};

  for (let i = indiceCabecalho + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha) continue;

    const digitos = apenasDigitos(String(linha[mapeamento.codigo] || ""));
    if (digitos.length < 6) continue;

    produtos[digitos] = {
      registro: mapeamento.registro != null ? String(linha[mapeamento.registro] || "").trim() : "",
      descricao: String(linha[mapeamento.descricao] || "").trim(),
      apresentacao: mapeamento.apresentacao != null ? String(linha[mapeamento.apresentacao] || "").trim() : "",
      laboratorio: mapeamento.laboratorio != null ? String(linha[mapeamento.laboratorio] || "").trim() : ""
    };
  }

  const total = Object.keys(produtos).length;

  if (!total) {
    toast("Nenhum produto com código de barras válido foi encontrado nessa planilha.");
    el("statusImportacao").textContent = "";
    return;
  }

  baseImportada = produtos;
  el("statusBase").textContent = `${total.toLocaleString("pt-BR")} produtos importados`;
  el("statusImportacao").textContent = `✅ "${nomeArquivo}": ${total.toLocaleString("pt-BR")} produtos disponíveis pra busca.`;
  toast(`Planilha importada: ${total.toLocaleString("pt-BR")} produtos ✅`);
}

/* =========================
☁️ SINCRONIZAÇÃO EM TEMPO REAL (Google Sheets)
========================= */
function iniciarConfigNuvem() {
  el("campoUrlNuvem").value = urlNuvem;
  atualizarStatusNuvem(urlNuvem ? "ok" : "off");
  atualizarBotaoRessincronizar();
}

function toggleConfigNuvem() {
  const body = el("configNuvemBody");
  const aberto = body.style.display !== "none";
  body.style.display = aberto ? "none" : "block";
  el("setaConfigNuvem").textContent = aberto ? "▾" : "▴";
}

function atualizarStatusNuvem(estado) {
  const badge = el("statusNuvem");
  badge.classList.remove("conf-badge-off", "conf-badge-ok", "conf-badge-erro");

  if (estado === "ok") {
    badge.textContent = "conectada";
    badge.classList.add("conf-badge-ok");
  } else if (estado === "erro") {
    badge.textContent = "erro ao conectar";
    badge.classList.add("conf-badge-erro");
  } else {
    badge.textContent = "não configurada";
    badge.classList.add("conf-badge-off");
  }
}

async function salvarConfigNuvem() {
  const valor = el("campoUrlNuvem").value.trim();

  if (!valor) {
    urlNuvem = "";
    localStorage.setItem(URL_NUVEM_KEY, "");
    atualizarStatusNuvem("off");
    toast("Sincronização desativada");
    return;
  }

  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(valor)) {
    toast("Essa URL não parece um link do Apps Script (deve terminar em /exec)");
    return;
  }

  toast("Testando conexão...");

  try {
    const res = await fetch(valor);
    const data = await res.json();
    if (!data.ok) throw new Error("resposta inesperada");

    urlNuvem = valor;
    localStorage.setItem(URL_NUVEM_KEY, urlNuvem);
    atualizarStatusNuvem("ok");
    toast("Planilha conectada ✅");
  } catch (e) {
    console.error("Erro ao testar URL da nuvem", e);
    atualizarStatusNuvem("erro");
    toast("Não consegui conectar nessa URL. Confira o passo a passo do apps-script-balanco.gs");
  }
}

async function sincronizarComNuvem(registro) {
  if (!urlNuvem) return false;

  try {
    const res = await fetch(urlNuvem, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS no Apps Script
      body: JSON.stringify(registro)
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.ok;
  } catch (e) {
    console.error("Erro ao sincronizar com a planilha", e);
    return false;
  }
}

function atualizarBotaoRessincronizar() {
  const pendentes = historico.filter(r => urlNuvem && !r.sincronizado).length;
  const btn = el("btnRessincronizar");
  btn.style.display = pendentes > 0 ? "inline-flex" : "none";
  btn.textContent = `🔄 Ressincronizar pendentes (${pendentes})`;
}

async function ressincronizarPendentes() {
  if (!urlNuvem) return toast("Configure a URL da planilha primeiro");

  const pendentes = historico.filter(r => !r.sincronizado);
  if (!pendentes.length) return;

  toast(`Sincronizando ${pendentes.length} item(ns)...`);

  for (const r of pendentes) {
    r.sincronizado = await sincronizarComNuvem(r);
  }

  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
  renderHistorico();

  const restam = historico.filter(r => !r.sincronizado).length;
  toast(restam ? `${restam} item(ns) ainda não sincronizados` : "Tudo sincronizado ✅");
}

/* =========================
📷 LEITOR DE CÓDIGO DE BARRAS
========================= */
async function iniciarLeitor() {
  if (leitorAtivo) return;

  if (typeof Html5Qrcode === "undefined") {
    toast("Biblioteca do leitor não carregou. Verifique sua conexão.");
    return;
  }

  if (!window.isSecureContext) {
    toast("Abra o site em HTTPS para usar a câmera (obrigatório no iOS/Safari).");
    return;
  }

  leitorAtivo = new Html5Qrcode("leitor", {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39
    ],
    verbose: false
  });

  const configLeitura = { fps: 10, qrbox: { width: 280, height: 150 } };

  try {
    // No iOS/Safari o facingMode "environment" às vezes falha silenciosamente
    // (principalmente em iPhones mais antigos ou em modo PWA). Tenta primeiro
    // o jeito simples e, se falhar, escolhe a câmera manualmente pela lista.
    await leitorAtivo.start({ facingMode: "environment" }, configLeitura, onLeituraSucesso, () => {});
  } catch (err1) {
    console.warn("facingMode environment falhou, tentando listar câmeras", err1);
    try {
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || !cameras.length) throw new Error("Nenhuma câmera encontrada");

      // Prioriza uma câmera cujo nome sugira ser a traseira; senão usa a última
      // da lista (no iOS, quando há 2 câmeras, a traseira normalmente vem depois).
      const traseira = cameras.find(c => /back|traseira|rear|environment/i.test(c.label));
      const escolhida = traseira || cameras[cameras.length - 1];

      await leitorAtivo.start(escolhida.id, configLeitura, onLeituraSucesso, () => {});
    } catch (err2) {
      console.error("Erro ao iniciar câmera", err2);
      toast("Não foi possível acessar a câmera. Verifique a permissão nas Configurações do Safari, ou use a busca manual.");
      leitorAtivo = null;
      return;
    }
  }

  el("btnIniciar").style.display = "none";
  el("btnParar").style.display = "inline-flex";
}

function pararLeitor() {
  if (!leitorAtivo) return;

  leitorAtivo
    .stop()
    .then(() => leitorAtivo.clear())
    .catch(() => {})
    .finally(() => {
      leitorAtivo = null;
      el("btnIniciar").style.display = "inline-flex";
      el("btnParar").style.display = "none";
    });
}

function onLeituraSucesso(codigoLido) {
  const agora = Date.now();
  // Evita processar o mesmo código várias vezes seguidas enquanto a câmera continua mirando nele
  if (codigoLido === ultimoCodigoLido && agora - ultimoCodigoTimestamp < 3000) return;

  ultimoCodigoLido = codigoLido;
  ultimoCodigoTimestamp = agora;

  if (navigator.vibrate) navigator.vibrate(120);
  buscarPorCodigo(codigoLido);
}

/* =========================
🔎 BUSCA NA BASE IMPORTADA
========================= */
function buscarProdutoPorEan(codigo) {
  if (!baseImportada) return null;

  const digitos = apenasDigitos(codigo);
  if (digitos.length < 6) return null;

  // Tenta o código exato e variações comuns de GTIN (14 -> 13 dígitos removendo
  // o indicador de embalagem; 12 -> 13 dígitos com zero à esquerda).
  const candidatos = new Set([digitos]);
  if (digitos.length === 14) candidatos.add(digitos.slice(1));
  if (digitos.length === 12) candidatos.add("0" + digitos);

  for (const c of candidatos) {
    if (baseImportada[c]) return baseImportada[c];
  }
  return null;
}

function buscarPorCodigo(codigoBruto) {
  const codigo = apenasDigitos(codigoBruto);
  if (!codigo) {
    toast("Digite ou escaneie um código válido");
    return;
  }

  const registro = buscarProdutoPorEan(codigo);
  mostrarResultado(codigo, registro);
}

/* =========================
📋 RESULTADO
========================= */
function mostrarResultado(codigo, registro) {
  el("resultadoCard").style.display = "block";
  el("avisoNaoEncontrado").style.display = registro ? "none" : "block";

  el("campoCodigo").value = codigo;
  el("campoRegistro").value = registro ? registro.registro : "";
  el("campoDescricao").value = registro ? registro.descricao : "";
  el("campoApresentacao").value = registro ? registro.apresentacao : "";
  el("campoLaboratorio").value = registro ? registro.laboratorio : "";

  el("campoLote").value = "";
  el("campoValidade").value = "";
  el("campoQuantidade").value = "";

  el("resultadoCard").scrollIntoView({ behavior: "smooth", block: "start" });
  el("campoLote").focus();
}

function limparResultado() {
  el("resultadoCard").style.display = "none";
  el("codigoManual").value = "";
}

async function salvarRegistro() {
  const codigo = el("campoCodigo").value.trim();
  const registroMs = el("campoRegistro").value.trim();
  const descricao = el("campoDescricao").value.trim();
  const apresentacao = el("campoApresentacao").value.trim();
  const lote = el("campoLote").value.trim();
  const validade = el("campoValidade").value;
  const quantidade = el("campoQuantidade").value;

  if (!descricao) return toast("Informe ao menos a descrição do produto");
  if (!lote) return toast("Informe o lote");
  if (!validade) return toast("Informe a validade");
  if (!dataBrValida(validade)) return toast("Validade inválida. Use o formato dd/mm/aaaa");
  if (!quantidade || Number(quantidade) <= 0) return toast("Informe uma quantidade válida");

  const registro = {
    codigo,
    registroMs,
    descricao,
    apresentacao,
    lote,
    validade,
    quantidade: Number(quantidade),
    salvoEm: new Date().toISOString(),
    sincronizado: !urlNuvem // sem URL configurada, não há o que sincronizar
  };

  historico.unshift(registro);
  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
  renderHistorico();
  limparResultado();
  toast(urlNuvem ? "Registro salvo ✅ sincronizando com a planilha..." : "Registro salvo ✅");

  if (urlNuvem) {
    registro.sincronizado = await sincronizarComNuvem(registro);
    localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
    renderHistorico();
    if (!registro.sincronizado) toast("⚠️ Salvo localmente, mas não sincronizou com a planilha");
  }
}

/* =========================
🗂️ HISTÓRICO
========================= */
function formatarDataBr(data) {
  if (!data) return "";
  // Compatibilidade com registros antigos, salvos no formato ISO (aaaa-mm-dd)
  // pelo antigo campo <input type="date">. Registros novos já vêm em dd/mm/aaaa.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : data;
}

function statusNuvemLinha(r) {
  if (!urlNuvem) return `<span title="Sincronização não configurada">—</span>`;
  if (r.sincronizado) return `<span title="Sincronizado com a planilha">☁️</span>`;
  return `<span title="Ainda não sincronizado">⏳</span>`;
}

function renderHistorico() {
  const corpo = el("corpoHistorico");
  const vazio = el("historicoVazio");

  el("contadorHistorico").textContent = historico.length;
  atualizarBotaoRessincronizar();

  if (!historico.length) {
    corpo.innerHTML = "";
    vazio.style.display = "block";
    return;
  }

  vazio.style.display = "none";

  corpo.innerHTML = historico.map((r, i) => `
    <tr>
      <td>${r.registroMs || "-"}</td>
      <td>${r.descricao}</td>
      <td>${r.apresentacao || "-"}</td>
      <td>${r.lote}</td>
      <td>${formatarDataBr(r.validade)}</td>
      <td>${r.quantidade}</td>
      <td>${statusNuvemLinha(r)}</td>
      <td><button class="btn-remover" onclick="removerRegistro(${i})" aria-label="Remover">🗑️</button></td>
    </tr>
  `).join("");
}

function removerRegistro(indice) {
  historico.splice(indice, 1);
  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
  renderHistorico();
}

function limparHistorico() {
  if (!historico.length) return;
  if (!confirm("Remover todos os registros salvos?")) return;

  historico = [];
  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
  renderHistorico();
}

/* =========================
⬇️ EXPORTAR CSV / TXT (colunas separadas por ;)
========================= */
function csvEscape(valor) {
  const s = String(valor ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function montarTextoDelimitado() {
  const cabecalho = ["Código", "Registro MS", "Descrição", "Apresentação", "Lote", "Validade", "Quantidade", "Salvo em"];
  const linhas = historico.map(r => [
    r.codigo, r.registroMs, r.descricao, r.apresentacao, r.lote, formatarDataBr(r.validade), r.quantidade, r.salvoEm
  ].map(csvEscape).join(";"));

  return "﻿" + [cabecalho.join(";"), ...linhas].join("\n");
}

function baixarArquivoTexto(conteudo, nomeArquivo, mime) {
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportarCSV() {
  if (!historico.length) return toast("Nenhum registro para exportar");
  const nome = `balanco_medicamentos_${new Date().toISOString().slice(0, 10)}.csv`;
  baixarArquivoTexto(montarTextoDelimitado(), nome, "text/csv;charset=utf-8;");
}

function exportarTXT() {
  if (!historico.length) return toast("Nenhum registro para exportar");
  const nome = `balanco_medicamentos_${new Date().toISOString().slice(0, 10)}.txt`;
  baixarArquivoTexto(montarTextoDelimitado(), nome, "text/plain;charset=utf-8;");
}

/* =========================
📊 EXPORTAR BALANÇO (XLSX)
========================= */
function exportarXLSX() {
  if (!historico.length) return toast("Nenhum item no balanço para exportar");

  if (typeof XLSX === "undefined") {
    toast("Biblioteca de exportação não carregou. Verifique sua conexão.");
    return;
  }

  const agora = new Date();
  const dataHora = agora.toLocaleString("pt-BR");
  const totalItens = historico.length;
  const totalUnidades = historico.reduce((soma, r) => soma + (Number(r.quantidade) || 0), 0);

  const cabecalhoColunas = ["Registro MS", "Descrição", "Apresentação", "Lote", "Validade", "Quantidade", "Código de barras"];

  // Ordena por descrição para facilitar a conferência física no balanço
  const linhasOrdenadas = [...historico].sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));

  const linhasDados = linhasOrdenadas.map(r => [
    r.registroMs || "-",
    r.descricao,
    r.apresentacao || "-",
    r.lote,
    formatarDataBr(r.validade),
    r.quantidade,
    r.codigo || "-"
  ]);

  const aoa = [
    ["Balanço de Medicamentos — Drogaria Mais Barato"],
    [`Data do balanço: ${dataHora}`],
    [`Total de itens: ${totalItens}    |    Total de unidades: ${totalUnidades}`],
    [],
    cabecalhoColunas,
    ...linhasDados,
    [],
    ["", "", "", "", "TOTAL", totalUnidades, ""]
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 16 }, // Registro MS
    { wch: 34 }, // Descrição
    { wch: 40 }, // Apresentação
    { wch: 14 }, // Lote
    { wch: 12 }, // Validade
    { wch: 12 }, // Quantidade
    { wch: 16 }  // Código de barras
  ];

  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Balanço");

  XLSX.writeFile(wb, `balanco_medicamentos_${agora.toISOString().slice(0, 10)}.xlsx`);
}
