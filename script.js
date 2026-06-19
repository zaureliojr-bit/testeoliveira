/* =========================
⚙️ CONFIG
========================= */
const API = "https://script.google.com/macros/s/AKfycbxUd531Z1Ew1M0eXpvKm0EY6cEcIbE7XeoSSkzteMz4TEBu_ekBa2QJR2ttF7Er4I2UZg/exec";
const WHATS_LOJA = "5511925190101";
const POR_PAGINA = 24;
const PLACEHOLDER = "https://placehold.co/100x100/ececff/5c5c94?text=💊";

/* FRETE */
const LOJA_LAT = -23.7092450;
const LOJA_LNG = -46.5251954;
const VALOR_POR_KM = 1.50;
const RAIO_MAX_KM = 8;
const TAXA_MINIMA = 3.00;

/* =========================
🗄️ ESTADO
========================= */
let produtos = [];
let produtosFiltrados = [];
let maisVendidos = [];
let carrinho = JSON.parse(localStorage.getItem("carrinho")) || [];
let categoriaAtual = "todas";
let termoBusca = "";
let pagina = 0;
let carregando = false;
let freteCalculado = null;
let timeoutBusca;
let toastTimer;

/* =========================
🛠️ HELPERS
========================= */
const el = id => document.getElementById(id);

const fmt = v =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

function telValido(tel) {
  return tel.replace(/\D/g, "").length >= 10;
}

function toast(msg) {
  const t = el("toast");
  if (!t) return;
  clearTimeout(toastTimer);
  t.textContent = msg;
  t.className = "toast ativo";
  toastTimer = setTimeout(() => (t.className = "toast"), 2800);
}

/* =========================
🕒 STATUS LOJA
========================= */
function atualizarStatusLoja() {
  const statusEl = el("status");
  if (!statusEl) return;

  const agora = new Date();
  const dia = agora.getDay();
  const minutos = agora.getHours() * 60 + agora.getMinutes();

  const domingo = dia === 0;
  const abre = domingo ? 8 * 60 : 7 * 60;
  const fecha = domingo ? 19 * 60 + 30 : 21 * 60 + 30;

  const aberto = minutos >= abre && minutos < fecha;

  statusEl.textContent = aberto ? "🟢 Aberto" : "🔴 Fechado";
  statusEl.className = aberto ? "status-aberto" : "status-fechado";
}

/* =========================
🚀 INIT
========================= */
document.addEventListener("DOMContentLoaded", () => {
  carregar();

  atualizarStatusLoja();
  setInterval(atualizarStatusLoja, 60000);

  el("busca")?.addEventListener("input", e => {
    clearTimeout(timeoutBusca);
    timeoutBusca = setTimeout(() => {
      termoBusca = e.target.value.toLowerCase().trim();
      aplicarFiltro();
    }, 300);
  });

  el("voltarTopo")?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.addEventListener("scroll", () => {
    if (carregando) return;

    const dist =
      document.documentElement.scrollHeight -
      window.scrollY -
      window.innerHeight;

    if (dist < 400) renderMais();
  });

  toggleEndereco();
  iniciarBanner();
});

/* =========================
📡 CARREGAR PRODUTOS
========================= */
async function carregar() {
  const container = el("produtos");

  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    produtos = await res.json();
    if (!Array.isArray(produtos) || !produtos.length) {
      throw new Error("Lista de produtos vazia");
    }

    maisVendidos = [...produtos]
      .sort(() => Math.random() - 0.5)
      .slice(0, 12);

    gerarFiltros();
    aplicarFiltro();
    renderMaisVendidos();
    renderCarrinho();
    atualizarTotais();
  } catch (e) {
    console.error("Erro ao carregar produtos", e);
    if (container) {
      container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:30px 14px;">
          <p style="margin-bottom:10px;">😕 Não foi possível carregar os produtos.</p>
          <button class="btn-buscar" onclick="carregar()">Tentar novamente</button>
        </div>
      `;
    }
  }
}

/* =========================
🏷️ FILTROS POR CATEGORIA
========================= */
function gerarFiltros() {
  const container = el("filtros");
  if (!container) return;

  const cats = ["todas", ...new Set(produtos.map(p => p.categoria).filter(Boolean))];

  container.innerHTML = cats.map(c => `
    <button
      data-categoria="${c}"
      class="${c === "todas" ? "ativo" : ""}"
      onclick="filtrarCategoria('${c}')"
    >${c === "todas" ? "🏠 Todos" : c}</button>
  `).join("");
}

function filtrarCategoria(cat) {
  categoriaAtual = cat;

  document.querySelectorAll("#filtros button").forEach(btn => {
    btn.classList.toggle("ativo", btn.dataset.categoria === cat);
  });

  aplicarFiltro();
}

/* =========================
🔎 BUSCA
========================= */
function buscar() {
  clearTimeout(timeoutBusca);
  termoBusca = (el("busca")?.value || "").toLowerCase().trim();
  aplicarFiltro();
  el("produtos")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function aplicarFiltro() {
  produtosFiltrados = produtos.filter(p =>
    (categoriaAtual === "todas" || p.categoria === categoriaAtual) &&
    (!termoBusca || p.nome.toLowerCase().includes(termoBusca))
  );

  pagina = 0;
  el("produtos").innerHTML = "";
  renderMais();
}

/* =========================
📦 RENDER PRODUTOS (grid principal)
========================= */
function renderMais() {
  const container = el("produtos");
  if (!container || carregando) return;

  carregando = true;

  const inicio = pagina * POR_PAGINA;
  const slice = produtosFiltrados.slice(inicio, inicio + POR_PAGINA);

  if (slice.length === 0 && pagina === 0) {
    container.innerHTML = "<p style='grid-column:1/-1; text-align:center'>Nenhum produto encontrado</p>";
    carregando = false;
    return;
  }

  const frag = document.createDocumentFragment();

  slice.forEach(p => {
    const qtd = carrinho.find(i => i.codigo == p.codigo)?.qtd || 0;

    const div = document.createElement("div");
    div.className = "card";
    div.dataset.codigo = p.codigo;

    div.innerHTML = `
      <img src="${p.imagem || PLACEHOLDER}" onerror="this.src='${PLACEHOLDER}'" alt="${p.nome}">
      <b>${p.nome}</b>
      <span class="preco">${fmt(p.preco)}</span>

      <div class="controle">
        <button onclick="menos('${p.codigo}')" aria-label="Remover">−</button>
        <span>${qtd}</span>
        <button onclick="mais('${p.codigo}')" aria-label="Adicionar">+</button>
      </div>
    `;

    frag.appendChild(div);
  });

  container.appendChild(frag);
  pagina++;
  carregando = false;
}

/* =========================
🔥 MAIS VENDIDOS
========================= */
function renderMaisVendidos() {
  const container = el("listaMaisVendidos");
  if (!container) return;

  container.innerHTML = maisVendidos.map(p => {
    const qtd = carrinho.find(i => i.codigo == p.codigo)?.qtd || 0;

    return `
      <div class="card-mini" data-codigo="${p.codigo}">
        <img src="${p.imagem || PLACEHOLDER}" onerror="this.src='${PLACEHOLDER}'" alt="${p.nome}">
        <b>${p.nome}</b>
        <span class="preco">${fmt(p.preco)}</span>
        <div class="controle-mini">
          <button onclick="menos('${p.codigo}')" aria-label="Remover">−</button>
          <span>${qtd}</span>
          <button onclick="mais('${p.codigo}')" aria-label="Adicionar">+</button>
        </div>
      </div>
    `;
  }).join("");
}

/* =========================
🔄 SINCRONIZAR QUANTIDADE NA TELA
(atualiza o card no grid principal E no mais vendidos
sem precisar re-renderizar tudo)
========================= */
function atualizarQtdNaTela(codigo) {
  const qtd = carrinho.find(i => i.codigo == codigo)?.qtd || 0;

  document.querySelectorAll(`[data-codigo="${codigo}"]`).forEach(card => {
    const span = card.querySelector(".controle span, .controle-mini span");
    if (span) span.textContent = qtd;
  });
}

/* =========================
🛒 CARRINHO — adicionar / remover
========================= */
function mais(codigo) {
  const p = produtos.find(i => i.codigo == codigo);
  if (!p) return;

  const item = carrinho.find(i => i.codigo == codigo);

  if (item) item.qtd++;
  else carrinho.push({ codigo: p.codigo, nome: p.nome, preco: p.preco, imagem: p.imagem, qtd: 1 });

  atualizarQtdNaTela(codigo);
  salvar();
}

function menos(codigo) {
  const item = carrinho.find(i => i.codigo == codigo);
  if (!item) return;

  item.qtd--;
  if (item.qtd <= 0) carrinho = carrinho.filter(i => i.codigo != codigo);

  atualizarQtdNaTela(codigo);
  salvar();
}

function salvar() {
  localStorage.setItem("carrinho", JSON.stringify(carrinho));
  renderCarrinho();
  atualizarTotais();
}

function limparCarrinho() {
  carrinho = [];

  document.querySelectorAll("[data-codigo]").forEach(card => {
    const span = card.querySelector(".controle span, .controle-mini span");
    if (span) span.textContent = "0";
  });

  resetarFrete();
  salvar();
}

function toggleCarrinho() {
  el("carrinho")?.classList.toggle("ativo");
}

/* =========================
📋 RENDER LISTA DO CARRINHO
========================= */
function renderCarrinho() {
  const container = el("itens");
  if (!container) return;

  if (!carrinho.length) {
    container.innerHTML = "<p style='text-align:center; color:var(--text-muted); padding:12px 0;'>Seu carrinho está vazio</p>";
    return;
  }

  container.innerHTML = carrinho.map(p => `
    <div class="item">
      <div class="item-info">
        <b>${p.nome}</b><br>
        <small>${fmt(p.preco)} cada</small>
      </div>
      <div class="item-qtd">
        <button class="qtd-btn" onclick="menos('${p.codigo}')" aria-label="Remover">−</button>
        <span>${p.qtd}</span>
        <button class="qtd-btn" onclick="mais('${p.codigo}')" aria-label="Adicionar">+</button>
      </div>
    </div>
  `).join("");
}

/* =========================
💰 TOTAIS
========================= */
function atualizarTotais() {
  let subtotal = 0;
  let qtd = 0;

  carrinho.forEach(p => {
    subtotal += p.preco * p.qtd;
    qtd += p.qtd;
  });

  const tipo = el("tipoEntrega")?.value;
  const frete = (tipo === "Entrega" && freteCalculado) ? freteCalculado.valor : 0;
  const totalGeral = subtotal + frete;

  el("total") && (el("total").textContent = fmt(totalGeral));
  el("qtd") && (el("qtd").textContent = qtd);
  el("qtdTop") && (el("qtdTop").textContent = `(${qtd})`);
  el("totalTop") && (el("totalTop").textContent = fmt(totalGeral));
}

/* =========================
🚚 TIPO DE ENTREGA
========================= */
function toggleEndereco() {
  const tipo = el("tipoEntrega")?.value;
  const box = el("boxEndereco");
  if (!box) return;

  box.style.display = tipo === "Entrega" ? "flex" : "none";
  if (tipo !== "Entrega") resetarFrete();
  atualizarTotais();
}

/* =========================
📮 CEP — máscara e busca (ViaCEP)
========================= */
function mascaraCEP(input) {
  let v = input.value.replace(/\D/g, "").slice(0, 8);
  if (v.length > 5) v = v.replace(/(\d{5})(\d)/, "$1-$2");
  input.value = v;
}

function limparCamposEndereco() {
  ["endereco", "bairro", "cidade"].forEach(id => { if (el(id)) el(id).value = ""; });
}

async function buscarCEP() {
  const cep = el("cep")?.value.replace(/\D/g, "");
  resetarFrete();

  if (!cep || cep.length !== 8) return;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await res.json();

    if (data.erro) {
      toast("CEP não encontrado");
      limparCamposEndereco();
      return;
    }

    el("endereco").value = data.logradouro || "";
    el("bairro").value = data.bairro || "";
    el("cidade").value = data.localidade || "";
    el("numero")?.focus();
  } catch (e) {
    console.error("Erro buscar CEP", e);
    toast("Erro ao buscar CEP");
  }
}

/* =========================
🚚 FRETE (geocodificação + distância)
========================= */
async function geocodificar(params) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&${params}`;

  const res = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
  const data = await res.json();

  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon)
  };
}

/* Tenta achar o endereço do mais preciso pro mais amplo, até conseguir
   coordenadas. O Nominatim é bem exigente com texto livre completo
   (rua + número + bairro + CEP juntos quase nunca casa), então é melhor
   ir afrouxando a busca aos poucos do que falhar de primeira. */
async function geocodificarComFallback({ numero, endereco, bairro, cidade, cepLimpo }) {
  const tentativas = [
    `street=${encodeURIComponent(`${numero} ${endereco}`)}&city=${encodeURIComponent(cidade)}&postalcode=${cepLimpo}`,
    `street=${encodeURIComponent(endereco)}&city=${encodeURIComponent(cidade)}`,
    `postalcode=${cepLimpo}&country=Brasil`,
    `q=${encodeURIComponent(`${endereco}, ${bairro}, ${cidade}, Brasil`)}`
  ];

  for (const params of tentativas) {
    try {
      const coords = await geocodificar(params);
      if (coords) return coords;
    } catch (e) {
      console.error("Tentativa de geocodificação falhou", params, e);
    }
  }

  return null;
}

function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mostrarResultadoFrete(msg, tipo) {
  const resultado = el("resultadoFrete");
  if (!resultado) return;

  resultado.textContent = msg;
  resultado.style.display = "block";
  resultado.classList.remove("ok", "erro");
  resultado.classList.add(tipo);
}

function resetarFrete() {
  freteCalculado = null;

  const resultado = el("resultadoFrete");
  if (resultado) {
    resultado.style.display = "none";
    resultado.textContent = "";
    resultado.classList.remove("ok", "erro");
  }

  atualizarTotais();
}

async function calcularFrete() {
  const numero = el("numero")?.value.trim();
  const endereco = el("endereco")?.value.trim();
  const bairro = el("bairro")?.value.trim();
  const cidade = el("cidade")?.value.trim();
  const cepLimpo = (el("cep")?.value || "").replace(/\D/g, "");

  if (!endereco || !cidade) return toast("Informe um CEP válido primeiro");
  if (!numero) return toast("Informe o número do endereço");

  const btn = el("btnCalcularFrete");
  if (btn) { btn.disabled = true; btn.textContent = "Calculando..."; }

  try {
    const coords = await geocodificarComFallback({ numero, endereco, bairro, cidade, cepLimpo });

    if (!coords) {
      freteCalculado = null;
      mostrarResultadoFrete("Não localizamos esse endereço automaticamente. Fale com a gente pelo WhatsApp para confirmar a entrega.", "erro");
      return;
    }

    const dist = calcularDistanciaKm(LOJA_LAT, LOJA_LNG, coords.lat, coords.lng);

    if (dist > RAIO_MAX_KM) {
      freteCalculado = null;
      mostrarResultadoFrete(`Endereço fora da área de entrega (${dist.toFixed(1)} km).`, "erro");
      return;
    }

    let valor = dist * VALOR_POR_KM;
    if (TAXA_MINIMA > 0 && valor < TAXA_MINIMA) valor = TAXA_MINIMA;

    freteCalculado = { dist, valor };
    mostrarResultadoFrete(`Taxa de entrega: ${fmt(valor)} (${dist.toFixed(1)} km)`, "ok");
  } catch (e) {
    console.error("Erro calcular frete", e);
    freteCalculado = null;
    mostrarResultadoFrete("Erro ao calcular a taxa de entrega. Tente novamente.", "erro");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📍 Calcular taxa de entrega"; }
    atualizarTotais();
  }
}

/* =========================
💳 PAGAMENTO
========================= */
function trocarPagamento() {
  const pagamento = el("pagamento")?.value;
  const box = el("boxTroco");
  if (!box) return;

  box.style.display = pagamento === "Dinheiro" ? "block" : "none";
  if (pagamento !== "Dinheiro" && el("trocoInput")) el("trocoInput").value = "";
}

/* =========================
🎠 BANNER
========================= */
function iniciarBanner() {
  const slides = document.querySelectorAll(".banner-slide");
  let i = 0;

  setInterval(() => {
    if (!slides.length) return;

    slides[i].classList.remove("ativo");
    i = (i + 1) % slides.length;
    slides[i].classList.add("ativo");
  }, 4000);
}

/* =========================
📦 FINALIZAR PEDIDO
========================= */
function finalizar() {
  if (!carrinho.length) return toast("Carrinho vazio");

  const nome = el("nome")?.value.trim();
  const telefone = el("telefone")?.value.trim();
  const tipoEntrega = el("tipoEntrega")?.value;
  const pagamento = el("pagamento")?.value;

  if (!nome) return toast("Informe seu nome");
  if (!telValido(telefone || "")) return toast("Informe um telefone válido");
  if (!pagamento) return toast("Escolha a forma de pagamento");

  let enderecoTexto = "";

  if (tipoEntrega === "Entrega") {
    const numero = el("numero")?.value.trim();
    const endereco = el("endereco")?.value.trim();
    const bairro = el("bairro")?.value.trim();
    const cidade = el("cidade")?.value.trim();
    const cep = el("cep")?.value.trim();

    if (!endereco || !numero) return toast("Preencha o endereço completo");
    if (!freteCalculado) return toast("Calcule a taxa de entrega antes de finalizar");

    enderecoTexto = `${endereco}, ${numero} - ${bairro}, ${cidade} - CEP ${cep}`;
  }

  let trocoTexto = "";
  if (pagamento === "Dinheiro") {
    const valorTroco = parseFloat(el("trocoInput")?.value);
    if (valorTroco > 0) trocoTexto = `\nTroco para: ${fmt(valorTroco)}`;
  }

  const subtotal = carrinho.reduce((a, b) => a + b.preco * b.qtd, 0);
  const frete = tipoEntrega === "Entrega" ? (freteCalculado?.valor || 0) : 0;
  const totalGeral = subtotal + frete;

  let msg = `🛒 NOVO PEDIDO\n\n`;

  carrinho.forEach(p => {
    msg += `${p.qtd}x ${p.nome} (Cód. ${p.codigo}) - ${fmt(p.preco * p.qtd)}\n`;
  });

  msg += `\nSubtotal: ${fmt(subtotal)}`;
  if (tipoEntrega === "Entrega") msg += `\nTaxa de entrega: ${fmt(frete)}`;
  msg += `\n*TOTAL: ${fmt(totalGeral)}*\n`;

  msg += `\n👤 ${nome}`;
  msg += `\n📞 ${telefone}`;
  msg += `\n${tipoEntrega === "Entrega" ? "🚚 Entrega" : "🏪 Retirada na loja"}`;
  if (enderecoTexto) msg += `\n📍 ${enderecoTexto}`;
  msg += `\n💳 ${pagamento}${trocoTexto}`;

  window.open(`https://wa.me/${WHATS_LOJA}?text=${encodeURIComponent(msg)}`, "_blank");

  toast("Pedido enviado! 🎉");
  limparCarrinho();
}