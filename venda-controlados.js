/* =========================
⚙️ CONFIG
========================= */
const DADOS_URL = "dados_conformidade.json";
const HISTORICO_KEY = "vendaControladosHistorico";
const URL_NUVEM_KEY = "vendaControladosUrlNuvem";

/* =========================
🗄️ ESTADO
========================= */
let baseConformidade = null; // { fonte, publicada, campos, produtos: { ean: [registro,produto,substancia,apresentacao,laboratorio,tarja] } }
let historico = JSON.parse(localStorage.getItem(HISTORICO_KEY)) || [];
let urlNuvem = localStorage.getItem(URL_NUVEM_KEY) || "";
let leitorAtivo = null;
let ultimoCodigoLido = "";
let ultimoCodigoTimestamp = 0;
let indiceEmEdicao = null; // índice do historico sendo editado, ou null se for uma venda nova

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

async function copiarCodigo(codigo) {
  if (!codigo) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(codigo);
    } else {
      // Fallback pra contexto sem HTTPS/API de clipboard (ex: navegadores mais antigos)
      const campo = document.createElement("textarea");
      campo.value = codigo;
      campo.style.position = "fixed";
      campo.style.opacity = "0";
      document.body.appendChild(campo);
      campo.focus();
      campo.select();
      document.execCommand("copy");
      document.body.removeChild(campo);
    }
    toast(`Código ${codigo} copiado ✅`);
  } catch (e) {
    console.error("Erro ao copiar código", e);
    toast("Não consegui copiar. Selecione o código manualmente.");
  }
}

function gerarId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  carregarBase();
  renderHistorico();
  iniciarConfigNuvem();
});

async function carregarBase() {
  try {
    const res = await fetch(DADOS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    baseConformidade = await res.json();

    const total = Object.keys(baseConformidade.produtos || {}).length;
    el("statusBase").textContent = `${total.toLocaleString("pt-BR")} produtos · ${baseConformidade.publicada || ""}`;
  } catch (e) {
    console.error("Erro ao carregar base de conformidade", e);
    el("statusBase").textContent = "⚠️ falha ao carregar base";
    toast("Não foi possível carregar a base de conformidade");
  }
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
🔎 BUSCA NA BASE DE CONFORMIDADE
========================= */
function buscarProdutoPorEan(codigo) {
  if (!baseConformidade || !baseConformidade.produtos) return null;

  const produtos = baseConformidade.produtos;
  const digitos = apenasDigitos(codigo);
  if (digitos.length < 12) return null;

  // Tenta o código exato e variações comuns:
  // - GTIN-14 (código de embalagem, primeiro dígito é o indicador) -> últimos 13
  // - UPC-A de 12 dígitos -> EAN-13 com zero à esquerda
  const candidatos = new Set([digitos]);
  if (digitos.length === 14) candidatos.add(digitos.slice(1));
  if (digitos.length === 12) candidatos.add("0" + digitos);

  for (const c of candidatos) {
    if (produtos[c]) return produtos[c];
  }
  return null;
}

function buscarPorCodigo(codigoBruto) {
  const codigo = apenasDigitos(codigoBruto);
  if (!codigo) {
    toast("Digite ou escaneie um código válido");
    return;
  }

  if (!baseConformidade) {
    toast("Base de conformidade ainda carregando, aguarde...");
    return;
  }

  const registro = buscarProdutoPorEan(codigo);
  mostrarResultado(codigo, registro);
}

/* =========================
📋 RESULTADO
========================= */
function mostrarResultado(codigo, registro) {
  const [reg, produto, substancia, apresentacao, laboratorio] = registro || ["", "", "", "", ""];

  indiceEmEdicao = null;
  el("tituloResultado").textContent = "Produto identificado";
  el("btnSalvarRegistro").textContent = "💾 Registrar venda";

  el("resultadoCard").style.display = "block";
  el("avisoNaoEncontrado").style.display = registro ? "none" : "block";

  el("campoCodigo").value = codigo;
  el("campoRegistro").value = reg;
  el("campoDescricao").value = produto && substancia ? `${produto} (${substancia})` : (produto || substancia);
  el("campoApresentacao").value = apresentacao;
  el("campoLaboratorio").value = laboratorio;

  el("campoLote").value = "";
  el("campoValidade").value = "";
  el("campoQuantidade").value = "";

  el("resultadoCard").scrollIntoView({ behavior: "smooth", block: "start" });
  el("campoLote").focus();
}

function editarRegistro(indice) {
  const r = historico[indice];
  if (!r) return;

  indiceEmEdicao = indice;
  el("tituloResultado").textContent = "Editar venda registrada";
  el("btnSalvarRegistro").textContent = "💾 Salvar alteração";

  el("resultadoCard").style.display = "block";
  el("avisoNaoEncontrado").style.display = "none";

  el("campoCodigo").value = r.codigo || "";
  el("campoRegistro").value = r.registroMs || "";
  el("campoDescricao").value = r.descricao || "";
  el("campoApresentacao").value = r.apresentacao || "";
  el("campoLaboratorio").value = "";

  el("campoLote").value = r.lote || "";
  el("campoValidade").value = r.validade || "";
  el("campoQuantidade").value = r.quantidade || "";

  el("resultadoCard").scrollIntoView({ behavior: "smooth", block: "start" });
  el("campoValidade").focus();
}

function limparResultado() {
  indiceEmEdicao = null;
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

  const editando = indiceEmEdicao !== null;
  const registroAnterior = editando ? historico[indiceEmEdicao] : null;

  const registro = {
    id: registroAnterior?.id || gerarId(),
    codigo,
    registroMs,
    descricao,
    apresentacao,
    lote,
    validade,
    quantidade: Number(quantidade),
    salvoEm: registroAnterior?.salvoEm || new Date().toISOString(),
    sincronizado: !urlNuvem // sem URL configurada, não há o que sincronizar
  };

  if (editando) {
    historico[indiceEmEdicao] = registro;
  } else {
    historico.unshift(registro);
  }

  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
  renderHistorico();
  limparResultado();
  toast(urlNuvem ? `${editando ? "Alteração salva" : "Venda registrada"} ✅ sincronizando com a planilha...` : `${editando ? "Alteração salva" : "Venda registrada"} ✅`);

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
      <td class="conf-codigo-copiar" onclick="copiarCodigo('${r.codigo}')" title="Toque para copiar">${r.codigo || "-"} 📋</td>
      <td>${r.registroMs || "-"}</td>
      <td>${r.descricao}</td>
      <td>${r.apresentacao || "-"}</td>
      <td>${r.lote}</td>
      <td>${formatarDataBr(r.validade)}</td>
      <td>${r.quantidade}</td>
      <td>${statusNuvemLinha(r)}</td>
      <td class="conf-tabela-acoes">
        <button class="btn-remover" onclick="editarRegistro(${i})" aria-label="Editar">✏️</button>
        <button class="btn-remover" onclick="removerRegistro(${i})" aria-label="Remover">🗑️</button>
      </td>
    </tr>
  `).join("");
}

function removerRegistro(indice) {
  limparResultado(); // evita deixar um formulário de edição aberto apontando pra um índice que vai mudar
  historico.splice(indice, 1);
  localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
  renderHistorico();
}

function limparHistorico() {
  if (!historico.length) return;
  if (!confirm("Remover todas as vendas registradas?")) return;

  limparResultado();
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
  const nome = `venda_controlados_${new Date().toISOString().slice(0, 10)}.csv`;
  baixarArquivoTexto(montarTextoDelimitado(), nome, "text/csv;charset=utf-8;");
}

function exportarTXT() {
  if (!historico.length) return toast("Nenhum registro para exportar");
  const nome = `venda_controlados_${new Date().toISOString().slice(0, 10)}.txt`;
  baixarArquivoTexto(montarTextoDelimitado(), nome, "text/plain;charset=utf-8;");
}

/* =========================
📊 EXPORTAR VENDAS (XLSX)
========================= */
function exportarXLSX() {
  if (!historico.length) return toast("Nenhuma venda registrada para exportar");

  if (typeof XLSX === "undefined") {
    toast("Biblioteca de exportação não carregou. Verifique sua conexão.");
    return;
  }

  const agora = new Date();
  const dataHora = agora.toLocaleString("pt-BR");
  const totalItens = historico.length;
  const totalUnidades = historico.reduce((soma, r) => soma + (Number(r.quantidade) || 0), 0);

  const cabecalhoColunas = ["Registro MS", "Descrição", "Apresentação", "Lote", "Validade", "Quantidade", "Código de barras"];

  // Ordena por descrição para facilitar a conferência
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
    ["Registro de Vendas — Produtos Controlados — Drogaria Mais Barato"],
    [`Gerado em: ${dataHora}`],
    [`Total de vendas: ${totalItens}    |    Total de unidades: ${totalUnidades}`],
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
  XLSX.utils.book_append_sheet(wb, ws, "Vendas");

  XLSX.writeFile(wb, `venda_controlados_${agora.toISOString().slice(0, 10)}.xlsx`);
}
