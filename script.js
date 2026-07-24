/* ============================================================
   CONDOR WMS — Separação de Pedidos
   script.js — lógica do aplicativo (vanilla JS)
   ============================================================ */

// =====================================================================
// CONFIGURAÇÃO — troque pela URL do seu Web App publicado (Apps Script)
// Instruções completas em README.md
// =====================================================================
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbw4NqKwO4BsAgPrckH4cMRaQlQ0dQxr94g64y07IZKiruHla6yzCnqXGhvr0S74Alr8/exec"
};

// =====================================================================
// ESTADO GLOBAL
// =====================================================================
const state = {
  user: null,           // { id, nome, login, perfil }
  ops: [],              // lista de OPs (com contadores calculados)
  itens: [],            // itens da OP atualmente aberta
  currentOP: null,      // OP atualmente aberta (objeto)
  parsedUpload: [],     // linhas interpretadas do excel/csv antes de confirmar
  chartOP: null,
  chartStatus: null
};

const STORAGE_KEY = "condor_wms_session";

// =====================================================================
// HELPERS DE UI
// =====================================================================
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return document.querySelectorAll(sel); }

function showLoader(text){
  $("#loader-text").textContent = text || "CARREGANDO...";
  $("#loader").classList.remove("hidden");
}
function hideLoader(){
  $("#loader").classList.add("hidden");
}

function toast(msg, type){
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  $("#toast-container").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .25s";
    setTimeout(() => el.remove(), 250);
  }, 3500);
}

function formatDateTime(d){
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// =====================================================================
// COMUNICAÇÃO COM O BACKEND (Google Apps Script)
// Usamos POST com Content-Type text/plain para evitar preflight CORS,
// e o Apps Script faz JSON.parse(e.postData.contents) do lado de lá.
// =====================================================================
async function api(action, payload){
  try{
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload: payload || {} })
    });
    const data = await res.json();
    if (!data.ok){
      throw new Error(data.error || "Erro desconhecido no servidor.");
    }
    return data.result;
  } catch(err){
    console.error("Erro na API:", err);
    throw err;
  }
}

// =====================================================================
// SESSÃO / LOGIN
// =====================================================================
function saveSession(user){
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}
function loadSession(){
  const raw = sessionStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}
function clearSession(){
  sessionStorage.removeItem(STORAGE_KEY);
}

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const login = $("#input-login").value.trim();
  const senha = $("#input-senha").value;
  $("#login-error").classList.add("hidden");
  $("#btn-login").disabled = true;
  $("#btn-login").textContent = "ENTRANDO...";

  try{
    const user = await api("login", { login, senha });
    state.user = user;
    saveSession(user);
    enterApp();
  } catch(err){
    $("#login-error-text").textContent = err.message || "Usuário ou senha inválidos.";
    $("#login-error").classList.remove("hidden");
  } finally{
    $("#btn-login").disabled = false;
    $("#btn-login").textContent = "ENTRAR";
  }
});

$("#btn-logout").addEventListener("click", () => {
  clearSession();
  state.user = null;
  $("#view-app").classList.add("hidden");
  $("#view-login").classList.remove("hidden");
  $("#input-login").value = "";
  $("#input-senha").value = "";
});

function enterApp(){
  $("#view-login").classList.add("hidden");
  $("#view-app").classList.remove("hidden");
  $("#user-name").textContent = state.user.nome;
  $("#user-role").textContent = state.user.perfil;

  // Apenas administradores veem a importação de OP
  if (String(state.user.perfil).toLowerCase() !== "administrador"){
    $("#nav-upload").classList.add("hidden");
  } else {
    $("#nav-upload").classList.remove("hidden");
  }

  navigateTo("dashboard");
}

// =====================================================================
// NAVEGAÇÃO (SPA)
// =====================================================================
const VIEWS = {
  dashboard: { title: "Dashboard", crumb: "Visão geral do almoxarifado", el: "#view-dashboard" },
  ops:       { title: "Ordens de Produção", crumb: "Selecione uma OP para separar", el: "#view-ops" },
  itens:     { title: "Separação de Itens", crumb: "", el: "#view-itens" },
  upload:    { title: "Importar OP", crumb: "Upload de planilha Excel/CSV", el: "#view-upload" }
};

function navigateTo(viewName){
  Object.values(VIEWS).forEach(v => $(v.el).classList.add("hidden"));
  $(VIEWS[viewName].el).classList.remove("hidden");

  $("#topbar-title").textContent = VIEWS[viewName].title;
  $("#topbar-crumb").textContent = VIEWS[viewName].crumb;
  $("#mobile-title").textContent = VIEWS[viewName].title;

  $all(".nav-item").forEach(btn => btn.classList.remove("active"));
  const navBtn = document.querySelector(`.nav-item[data-nav="${viewName === "itens" ? "ops" : viewName}"]`);
  if (navBtn) navBtn.classList.add("active");

  closeMobileMenu();

  if (viewName === "dashboard") loadDashboard();
  if (viewName === "ops") loadOps();
}

$all(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.nav));
});

$("#btn-back-ops").addEventListener("click", (e) => {
  e.preventDefault();
  navigateTo("ops");
});

// Mobile menu
function openMobileMenu(){
  $("#sidebar").classList.add("open");
  $("#sidebar-backdrop").classList.add("show");
}
function closeMobileMenu(){
  $("#sidebar").classList.remove("open");
  $("#sidebar-backdrop").classList.remove("show");
}
$("#btn-mobile-menu").addEventListener("click", openMobileMenu);
$("#sidebar-backdrop").addEventListener("click", closeMobileMenu);

// Relógio
function tickClock(){
  $("#clock").textContent = new Date().toLocaleTimeString("pt-BR");
}
setInterval(tickClock, 1000);
tickClock();

// =====================================================================
// DASHBOARD
// =====================================================================
async function loadDashboard(){
  showLoader("CARREGANDO INDICADORES...");
  try{
    const data = await api("getDashboard", {});
    $("#stat-op-abertas").textContent = data.opAbertas;
    $("#stat-itens-pendentes").textContent = data.itensPendentes;
    $("#stat-itens-separados").textContent = data.itensSeparados;
    $("#stat-pedidos-concluidos").textContent = data.pedidosConcluidos;

    renderChartOP(data.porOP || []);
    renderChartStatus(data);
  } catch(err){
    toast("Erro ao carregar dashboard: " + err.message, "error");
  } finally{
    hideLoader();
  }
}

function renderChartOP(porOP){
  const ctx = $("#chart-op").getContext("2d");
  const labels = porOP.map(o => o.op);
  const separados = porOP.map(o => o.separados);
  const pendentes = porOP.map(o => o.total - o.separados);

  if (state.chartOP) state.chartOP.destroy();
  state.chartOP = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Separados", data: separados, backgroundColor: "#22C55E", borderRadius: 4 },
        { label: "Pendentes", data: pendentes, backgroundColor: "#FF6A00", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#8C8C8C" } } },
      scales: {
        x: { stacked: true, ticks: { color: "#8C8C8C" }, grid: { color: "#242424" } },
        y: { stacked: true, ticks: { color: "#8C8C8C" }, grid: { color: "#242424" } }
      }
    }
  });
}

function renderChartStatus(data){
  const ctx = $("#chart-status").getContext("2d");
  if (state.chartStatus) state.chartStatus.destroy();
  state.chartStatus = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Pendente", "Em andamento", "Concluído"],
      datasets: [{
        data: [data.opPendente || 0, data.opAndamento || 0, data.pedidosConcluidos || 0],
        backgroundColor: ["#FF3B30", "#FFC107", "#22C55E"],
        borderColor: "#181818",
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom", labels: { color: "#8C8C8C" } } }
    }
  });
}

// =====================================================================
// LISTA DE OPs
// =====================================================================
async function loadOps(){
  showLoader("CARREGANDO ORDENS DE PRODUÇÃO...");
  try{
    state.ops = await api("getOPs", {});
    renderOps(state.ops);
  } catch(err){
    toast("Erro ao carregar OPs: " + err.message, "error");
  } finally{
    hideLoader();
  }
}

function statusInfo(op){
  if (op.total === 0) return { label: "PENDENTE", cls: "badge-pendente" };
  if (op.separados >= op.total) return { label: "CONCLUÍDO", cls: "badge-concluido" };
  if (op.separados > 0) return { label: "EM ANDAMENTO", cls: "badge-andamento" };
  return { label: "PENDENTE", cls: "badge-pendente" };
}

function renderOps(list){
  const grid = $("#op-grid");
  grid.innerHTML = "";

  if (!list.length){
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h16M4 12h16M4 17h10"/></svg>
      <div>Nenhuma ordem de produção encontrada.</div>
    </div>`;
    return;
  }

  list.forEach(op => {
    const st = statusInfo(op);
    const pct = op.total ? Math.round((op.separados / op.total) * 100) : 0;
    const card = document.createElement("div");
    card.className = "op-card";
    card.innerHTML = `
      <div class="op-card__top">
        <div>
          <div class="op-card__num">OP ${op.op}</div>
          <div class="op-card__cliente">${op.cliente || "—"}</div>
        </div>
        <span class="badge ${st.cls}">${st.label}</span>
      </div>
      <div class="op-card__date">📅 ${op.data || "—"} · ${op.total} itens</div>
      <div>
        <div class="progress-label"><span>${op.separados}/${op.total} separados</span><span>${pct}%</span></div>
        <div class="progress"><div class="progress__fill" style="width:${pct}%"></div></div>
      </div>
      <div class="op-card__footer">
        <button class="btn btn-primary btn-block" data-op="${op.op}">ABRIR PEDIDO</button>
      </div>
    `;
    card.querySelector("button").addEventListener("click", () => openOP(op));
    grid.appendChild(card);
  });
}

$("#search-ops").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = state.ops.filter(op =>
    String(op.op).toLowerCase().includes(q) ||
    String(op.cliente || "").toLowerCase().includes(q)
  );
  renderOps(filtered);
});

$("#btn-refresh-ops").addEventListener("click", loadOps);

// =====================================================================
// SEPARAÇÃO DE ITENS
// =====================================================================
async function openOP(op){
  state.currentOP = op;
  navigateTo("itens");
  $("#itens-op-num").textContent = "OP " + op.op;
  $("#itens-op-meta").textContent = `${op.cliente || "—"} · ${op.data || "—"}`;
  $("#topbar-crumb").textContent = "OP " + op.op;

  showLoader("CARREGANDO ITENS...");
  try{
    state.itens = await api("getItensByOP", { op: op.op });
    renderItens(state.itens);
  } catch(err){
    toast("Erro ao carregar itens: " + err.message, "error");
  } finally{
    hideLoader();
  }
}

function updateItensProgress(){
  const total = state.itens.length;
  const separados = state.itens.filter(i => Number(i.separado) === 1).length;
  const pct = total ? Math.round((separados / total) * 100) : 0;

  $("#itens-progress-label").textContent = `${separados} / ${total} separados`;
  $("#itens-progress-pct").textContent = pct + "%";
  $("#itens-progress-fill").style.width = pct + "%";

  const btnConcluir = $("#btn-concluir-op");
  btnConcluir.disabled = !(total > 0 && separados === total);

  toggleBaixarSeparacaoBtn();
}

function toggleBaixarSeparacaoBtn(){
  const btn = $("#btn-baixar-separacao");
  const input = $("#input-doc-numero");
  const op = state.currentOP;
  const jaConcluida = op && !!op.concluidoPor;
  btn.classList.toggle("hidden", !jaConcluida);
  input.classList.toggle("hidden", !jaConcluida);
}

function renderItens(list){
  const grid = $("#itens-grid");
  grid.innerHTML = "";

  if (!list.length){
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M9 9h.01M15 9h.01M8 15c1 1 2.5 1.5 4 1.5s3-.5 4-1.5"/></svg>
      <div>Nenhum item encontrado nesta OP.</div>
    </div>`;
    updateItensProgress();
    return;
  }

  list.forEach(item => {
    const done = Number(item.separado) === 1;
    const isParcial = done && Number(item.quantidade_separada) < Number(item.quantidade);
    const card = document.createElement("div");
    card.className = "item-card" + (done ? (isParcial ? " parcial" : " done") : "");
    card.innerHTML = `
      <div class="item-card__code">${item.item}</div>
      <div class="item-card__desc">${item.descricao || "—"}</div>
      <div class="item-card__meta">
        <div class="meta-block"><b>Microsiga</b><span>${item.microsiga || "—"}</span></div>
        <div class="meta-block"><b>Endereço</b><span>${item.endereco || "—"}</span></div>
        <div class="meta-block"><b>Lote</b><span>${done ? (item.lote_separado || "—") : "—"}</span></div>
        <div class="meta-block"><b>Quantidade</b><span class="qty">${item.quantidade}</span></div>
      </div>
      <div class="item-card__footer"></div>
    `;
    const footer = card.querySelector(".item-card__footer");
    if (done){
      if (isParcial){
        footer.innerHTML = `<div class="confirmed-tag parcial">⚠️ SEPARAÇÃO PARCIAL
          <small>${item.quantidade_separada} de ${item.quantidade} separados · Lote ${item.lote_separado || "—"}</small>
          <small>${item.usuario || ""} · ${item.data_separacao ? formatDateTime(item.data_separacao) : ""}</small>
        </div>`;
      } else {
        footer.innerHTML = `<div class="confirmed-tag">✅ SEPARADO
          <small>Lote ${item.lote_separado || "—"}</small>
          <small>${item.usuario || ""} · ${item.data_separacao ? formatDateTime(item.data_separacao) : ""}</small>
        </div>`;
      }
    } else {
      footer.innerHTML = `
        <div class="separacao-form">
          <div class="field-sm">
            <label>Quantidade separada (de ${item.quantidade})</label>
            <input type="number" class="input-qtd-separada" min="0" step="any" placeholder="0">
          </div>
          <div class="field-sm">
            <label>Lote</label>
            <input type="text" class="input-lote-separado" placeholder="Digite o lote separado">
          </div>
        </div>
        <button class="btn btn-primary btn-block btn-confirmar-separacao">✅ CONFIRMAR SEPARAÇÃO</button>
      `;
      const btn = footer.querySelector(".btn-confirmar-separacao");
      const inputQtd = footer.querySelector(".input-qtd-separada");
      const inputLote = footer.querySelector(".input-lote-separado");
      btn.addEventListener("click", () => confirmarSeparacao(item, btn, inputQtd, inputLote));
    }
    grid.appendChild(card);
  });

  updateItensProgress();
}

async function confirmarSeparacao(item, btn, inputQtd, inputLote){
  const qtdSeparada = parseFloat(String(inputQtd.value).replace(",", "."));
  const lote = inputLote.value.trim();

  if (isNaN(qtdSeparada) || qtdSeparada <= 0){
    toast("Informe a quantidade separada.", "error");
    inputQtd.focus();
    return;
  }
  if (qtdSeparada > Number(item.quantidade)){
    toast("A quantidade separada não pode ser maior que a quantidade do pedido.", "error");
    inputQtd.focus();
    return;
  }
  if (!lote){
    toast("Informe o lote separado.", "error");
    inputLote.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = "SALVANDO...";
  try{
    await api("confirmarSeparacao", {
      id: item.id,
      usuario: state.user.nome,
      quantidade_separada: qtdSeparada,
      lote: lote
    });
    item.separado = 1;
    item.quantidade_separada = qtdSeparada;
    item.lote_separado = lote;
    item.usuario = state.user.nome;
    item.data_separacao = new Date().toISOString();
    renderItens(state.itens);

    if (qtdSeparada < Number(item.quantidade)){
      toast(`Item ${item.item} com separação parcial (${qtdSeparada}/${item.quantidade}).`, "warning");
    } else {
      toast(`Item ${item.item} separado com sucesso.`, "success");
    }
  } catch(err){
    toast("Erro ao confirmar separação: " + err.message, "error");
    btn.disabled = false;
    btn.textContent = "✅ CONFIRMAR SEPARAÇÃO";
  }
}

$("#search-itens").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = state.itens.filter(i =>
    String(i.item).toLowerCase().includes(q) ||
    String(i.microsiga || "").toLowerCase().includes(q) ||
    String(i.endereco || "").toLowerCase().includes(q)
  );
  renderItens(filtered);
});

$("#btn-concluir-op").addEventListener("click", async () => {
  const total = state.itens.length;
  const separados = state.itens.filter(i => Number(i.separado) === 1).length;
  if (separados !== total || total === 0){
    toast("Ainda há itens pendentes de separação nesta OP.", "error");
    return;
  }
  showLoader("CONCLUINDO OP...");
  try{
    const resultado = await api("concluirOP", { op: state.currentOP.op, usuario: state.user.nome });
    state.currentOP.concluidoPor = resultado.concluidoPor;
    state.currentOP.dataConclusao = resultado.dataConclusao;
    toast(`OP ${state.currentOP.op} concluída com sucesso!`, "success");
    toggleBaixarSeparacaoBtn();
  } catch(err){
    toast("Erro ao concluir OP: " + err.message, "error");
  } finally{
    hideLoader();
  }
});

$("#btn-baixar-separacao").addEventListener("click", async () => {
  showLoader("GERANDO PDF...");
  try{
    // proteção: se por algum motivo cliente/data não estiverem no objeto em memória,
    // busca a lista de OPs de novo e completa antes de gerar o documento
    if (!state.currentOP.cliente || !state.currentOP.data){
      try{
        const opsAtualizadas = await api("getOPs", {});
        const atual = opsAtualizadas.find(o => String(o.op) === String(state.currentOP.op));
        if (atual){
          state.currentOP.cliente = state.currentOP.cliente || atual.cliente;
          state.currentOP.data = state.currentOP.data || atual.data;
          state.currentOP.concluidoPor = state.currentOP.concluidoPor || atual.concluidoPor;
          state.currentOP.dataConclusao = state.currentOP.dataConclusao || atual.dataConclusao;
        }
      } catch(e){ /* segue mesmo se não conseguir atualizar */ }
    }
    const numeroDocumento = $("#input-doc-numero").value.trim();
    await gerarEtiquetaPDF(state.currentOP, state.itens, numeroDocumento);
  } catch(err){
    toast("Erro ao gerar PDF: " + err.message, "error");
  } finally{
    hideLoader();
  }
});

// =====================================================================
// UPLOAD DE OP (EXCEL / CSV) — ADMINISTRADOR
// =====================================================================
const dropzone = $("#dropzone");
const fileInput = $("#file-input");

dropzone.addEventListener("click", () => fileInput.click());
["dragenter", "dragover"].forEach(evt => {
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
});
["dragleave", "drop"].forEach(evt => {
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); });
});
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleUploadFile(file);
});
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleUploadFile(file);
});

// Normaliza nomes de colunas (aceita variações de acentuação/maiúsculas)
function normalizeKey(k){
  return String(k).trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function handleUploadFile(file){
  showLoader("LENDO ARQUIVO...");
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const wb = XLSX.read(e.target.result, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      state.parsedUpload = rows.map(row => {
        const norm = {};
        Object.keys(row).forEach(k => norm[normalizeKey(k)] = row[k]);
        return {
          op: norm.OP || "",
          cliente: norm.CLIENTE || "",
          item: norm.ITEM || "",
          microsiga: norm.MICROSIGA || "",
          descricao: norm.DESCRICAO || norm.DESCRIÇÃO || "",
          endereco: norm.ENDERECO || norm.ENDEREÇO || "",
          lote: norm.LOTE || "",
          quantidade: norm.QTD || norm.QUANTIDADE || 0
        };
      }).filter(r => r.op && r.item);

      renderUploadPreview(state.parsedUpload);
    } catch(err){
      toast("Erro ao ler arquivo: " + err.message, "error");
    } finally{
      hideLoader();
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderUploadPreview(rows){
  const tbody = $("#upload-table-body");
  tbody.innerHTML = "";

  if (!rows.length){
    toast("Nenhuma linha válida encontrada. Verifique as colunas do arquivo.", "error");
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.op}</td><td>${r.cliente}</td><td>${r.item}</td><td>${r.microsiga}</td>
      <td>${r.descricao}</td><td>${r.endereco}</td><td>${r.lote}</td><td>${r.quantidade}</td>
    `;
    tbody.appendChild(tr);
  });

  $("#upload-preview").classList.remove("hidden");
}

$("#btn-cancel-upload").addEventListener("click", () => {
  state.parsedUpload = [];
  $("#upload-preview").classList.add("hidden");
  fileInput.value = "";
});

$("#btn-confirm-upload").addEventListener("click", async () => {
  if (!state.parsedUpload.length) return;
  showLoader("IMPORTANDO OP...");
  try{
    await api("uploadOP", { rows: state.parsedUpload });
    toast("Ordem de produção importada com sucesso!", "success");
    $("#upload-preview").classList.add("hidden");
    fileInput.value = "";
    state.parsedUpload = [];
  } catch(err){
    toast("Erro ao importar: " + err.message, "error");
  } finally{
    hideLoader();
  }
});

// =====================================================================
// ETIQUETA DE CONCLUSÃO (PDF)
// =====================================================================

function loadImageAsDataURL(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function gerarBarcodeDataURL(texto){
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, texto, { format: "CODE128", displayValue: false, margin: 0, height: 60 });
  return canvas.toDataURL("image/png");
}

async function gerarQRCodeDataURL(texto){
  return await QRCode.toDataURL(texto, { margin: 1, width: 200 });
}

async function gerarEtiquetaPDF(op, itens, numeroDocumento){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 30;
  let y = 32;

  // ---- Cabeçalho: logo + selo "ETIQUETA DE CONCLUSÃO" ----
  try{
    const logo = await loadImageAsDataURL("assets/logo.png");
    doc.addImage(logo, "PNG", margin, y, 130, 42);
  } catch(e){
    doc.setFont("helvetica", "bold"); doc.setFontSize(26);
    doc.text("CONDOR", margin, y + 30);
  }

  doc.setFillColor(10, 10, 10);
  doc.roundedRect(pageW - margin - 230, y, 230, 26, 4, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("ETIQUETA DE CONCLUSÃO", pageW - margin - 115, y + 17, { align: "center" });
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("SEPARAÇÃO DE ORDEM DE PRODUÇÃO", pageW - margin, y + 42, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(`Nº DO DOCUMENTO: ${numeroDocumento || "—"}`, pageW - margin, y + 55, { align: "right" });

  y += 78;

  // ---- Caixa: Nº da OP + Prédio ----
  const boxW = pageW - margin * 2;
  doc.setDrawColor(0); doc.setLineWidth(1);
  doc.roundedRect(margin, y, boxW, 58, 6, 6);
  const split1 = margin + boxW * 0.4;
  doc.line(split1, y, split1, y + 58);

  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text("NÚMERO DA OP:", margin + 12, y + 17);
  doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  doc.text(String(op.op), margin + 12, y + 42);

  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text("PRÉDIO:", split1 + 12, y + 17);
  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(String(op.cliente || "—"), split1 + 12, y + 40);

  y += 72;

  // ---- Caixa: datas + concluído por ----
  doc.roundedRect(margin, y, boxW, 54, 6, 6);
  const c1 = margin + boxW * 0.33;
  const c2 = margin + boxW * 0.68;
  doc.line(c1, y, c1, y + 54);
  doc.line(c2, y, c2, y + 54);

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text("DATA DE ABERTURA:", margin + 10, y + 15);
  doc.text("DATA/HORA DE CONCLUSÃO:", c1 + 10, y + 15);
  doc.text("CONCLUÍDO POR:", c2 + 10, y + 15);

  doc.setFont("helvetica", "bold"); doc.setFontSize(11.5);
  doc.text(String(op.data || "—"), margin + 10, y + 36);
  doc.text(String(op.dataConclusao || "—"), c1 + 10, y + 36);
  doc.text(String(op.concluidoPor || "—"), c2 + 10, y + 36, { maxWidth: (c2 === c1 ? boxW : (margin + boxW - c2 - 10)) });

  y += 70;

  // ---- Tabela de itens ----
  const linhas = itens.map((it, i) => {
    const qtdPedida = Number(it.quantidade) || 0;
    const qtdSeparadaRaw = it.quantidade_separada;
    const qtdSeparada = (qtdSeparadaRaw === "" || qtdSeparadaRaw === null || qtdSeparadaRaw === undefined)
      ? qtdPedida
      : Number(qtdSeparadaRaw);
    const status = qtdSeparada < qtdPedida ? "PARCIAL" : "COMPLETO";
    return [
      i + 1,
      it.microsiga || "—",
      it.descricao || "—",
      it.endereco || "—",
      it.lote_separado || it.lote || "—",
      qtdPedida,
      qtdSeparada,
      status,
      it.usuario || "—",
      it.data_separacao ? formatarDataHora(it.data_separacao) : "—"
    ];
  });

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [["ITEM", "MICROSIGA", "DESCRIÇÃO", "ENDEREÇO", "LOTE", "QTD PEDIDA", "QTD SEPARADA", "STATUS", "SEPARADO POR", "DATA/HORA DA SEPARAÇÃO"]],
    body: linhas,
    styles: { font: "helvetica", fontSize: 7, cellPadding: 3.5, lineColor: [0, 0, 0], lineWidth: 0.5, valign: "middle" },
    headStyles: { fillColor: [10, 10, 10], textColor: 255, fontStyle: "bold", halign: "center", fontSize: 6.8 },
    bodyStyles: { halign: "center" },
    columnStyles: { 2: { halign: "left" } },
    theme: "grid",
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 7){
        if (data.cell.raw === "PARCIAL"){
          data.cell.styles.textColor = [180, 90, 0];
          data.cell.styles.fontStyle = "bold";
        } else if (data.cell.raw === "COMPLETO"){
          data.cell.styles.textColor = [15, 130, 60];
          data.cell.styles.fontStyle = "bold";
        }
      }
    }
  });

  y = doc.lastAutoTable.finalY + 14;

  const qtdParciais = itens.filter(it => {
    const qtdPedida = Number(it.quantidade) || 0;
    const qs = it.quantidade_separada;
    const qtdSeparada = (qs === "" || qs === null || qs === undefined) ? qtdPedida : Number(qs);
    return qtdSeparada < qtdPedida;
  }).length;

  if (qtdParciais > 0){
    doc.setFillColor(74, 57, 0);
    doc.roundedRect(margin, y, pageW - margin * 2, 22, 4, 4, "F");
    doc.setTextColor(255, 217, 102);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(`⚠ ${qtdParciais} ITEM(NS) COM SEPARAÇÃO PARCIAL — QUANTIDADE SEPARADA MENOR QUE A PEDIDA`, margin + 10, y + 15);
    doc.setTextColor(0, 0, 0);
    y += 30;
  } else {
    y += 8;
  }

  // Quebra de página se não sobrar espaço suficiente pro rodapé
  const pageH = doc.internal.pageSize.getHeight();
  if (y + 305 > pageH){
    doc.addPage();
    y = 40;
  }

  // ---- Observações ----
  doc.roundedRect(margin, y, boxW, 88, 6, 6);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("OBSERVAÇÕES:", margin + 10, y + 16);
  doc.setDrawColor(170);
  for (let i = 0; i < 3; i++){
    const ly = y + 34 + i * 18;
    doc.line(margin + 10, ly, margin + boxW - 10, ly);
  }
  doc.setDrawColor(0);

  y += 104;

  // ---- Assinatura + Rastreabilidade ----
  const colW = (boxW - 16) / 2;
  doc.roundedRect(margin, y, colW, 150, 6, 6);
  doc.roundedRect(margin + colW + 16, y, colW, 150, 6, 6);

  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("ASSINATURA (CONFERENTE/EXPEDIÇÃO)", margin + 10, y + 16);
  doc.line(margin + 10, y + 70, margin + colW - 10, y + 70);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text("NOME LEGÍVEL:", margin + 10, y + 96);
  doc.line(margin + 78, y + 96, margin + colW - 10, y + 96);
  doc.text("DATA/HORA:", margin + 10, y + 122);
  doc.line(margin + 66, y + 122, margin + colW - 10, y + 122);

  const rastreioX = margin + colW + 16;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("RASTREABILIDADE DA OP", rastreioX + colW / 2, y + 16, { align: "center" });

  const barcode = gerarBarcodeDataURL(String(op.op));
  doc.addImage(barcode, "PNG", rastreioX + 20, y + 26, colW - 40, 32);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text("OP: " + op.op, rastreioX + colW / 2, y + 70, { align: "center" });

  try{
    const qr = await gerarQRCodeDataURL(`OP:${op.op}|PREDIO:${op.cliente || ""}|CONCLUIDO:${op.dataConclusao || ""}`);
    doc.addImage(qr, "PNG", rastreioX + colW / 2 - 34, y + 78, 68, 68);
  } catch(e){ /* segue sem QR se a lib falhar */ }

  y += 165;

  // ---- Rodapé ----
  doc.setFillColor(10, 10, 10);
  doc.rect(margin, y, boxW, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text("✔ Separação concluída conforme os itens listados. Etiqueta gerada automaticamente pelo sistema Condor.", margin + 10, y + 20);
  doc.text(String(op.dataConclusao || ""), margin + boxW - 10, y + 20, { align: "right" });

  doc.save(`Etiqueta_OP_${op.op}.pdf`);
}

function formatarDataHora(valor){
  const d = new Date(valor);
  if (isNaN(d.getTime())) return String(valor);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// =====================================================================
// INICIALIZAÇÃO
// =====================================================================
(function init(){
  const saved = loadSession();
  if (saved){
    state.user = saved;
    enterApp();
  }

  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
})();
