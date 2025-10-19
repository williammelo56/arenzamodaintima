// /public/admin.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = window.ENV?.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  alert("Preencha SUPABASE_URL e SUPABASE_ANON_KEY em /public/config.js");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Configurações =====
const SIZES = ["P", "M", "G", "GG", "G1", "G2"];
const BUCKET = "products"; // crie bucket 'products' no Storage (público)
const sizesBar = document.getElementById("sizesBar");
const sizesBlocks = document.getElementById("sizesBlocks");
const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");

const state = {
  nome: "",
  preco: "",
  descricao: "",
  modeloUrl: "",
  // para cada tamanho: { active: boolean, uploads: [{ name, url, path }] }
  tamanhos: Object.fromEntries(SIZES.map(sz => [sz, { active: false, uploads: [] }]))
};

// ===== Helpers =====
const slugify = (s) =>
  s.toString().toLowerCase()
   .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
   .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

function setStatus(msg, kind="muted") {
  statusEl.className = kind === "ok" ? "ok" : kind === "err" ? "err" : "muted";
  statusEl.textContent = msg;
}

function renderPreview() {
  const payload = buildPayload();
  previewEl.textContent = JSON.stringify(payload, null, 2);
}

function buildPayload() {
  // Constrói objeto final que iremos salvar
  const tamanhosOut = {};
  for (const sz of SIZES) {
    if (state.tamanhos[sz].active) {
      // Cada tamanho guarda um array de URLs públicas de imagens
      tamanhosOut[sz] = state.tamanhos[sz].uploads.map(u => u.url);
    }
  }
  return {
    nome: state.nome.trim(),
    preco: Number(state.preco || 0),
    descricao: state.descricao.trim(),
    modelo_url: state.modeloUrl.trim(),
    tamanhos: tamanhosOut // ← JSON (use JSONB no Supabase)
  };
}

// ===== Inputs básicos =====
document.getElementById("nome").addEventListener("input", (e) => {
  state.nome = e.target.value;
  renderPreview();
});
document.getElementById("preco").addEventListener("input", (e) => {
  state.preco = e.target.value;
  renderPreview();
});
document.getElementById("descricao").addEventListener("input", (e) => {
  state.descricao = e.target.value;
  renderPreview();
});
document.getElementById("modeloUrl").addEventListener("input", (e) => {
  state.modeloUrl = e.target.value;
  renderPreview();
});

// ===== Render dos botões de tamanho =====
function renderSizesBar() {
  sizesBar.innerHTML = "";
  SIZES.forEach(sz => {
    const btn = document.createElement("button");
    btn.className = "size-btn";
    btn.textContent = sz;
    if (state.tamanhos[sz].active) btn.classList.add("active");
    btn.addEventListener("click", () => toggleSize(sz, btn));
    sizesBar.appendChild(btn);
  });
}

function toggleSize(sz, btnEl) {
  const wasActive = state.tamanhos[sz].active;
  state.tamanhos[sz].active = !wasActive;
  // Toggle visual
  btnEl.classList.toggle("active", state.tamanhos[sz].active);
  // Render blocos
  renderSizeBlocks();
  renderPreview();
}

function renderSizeBlocks() {
  sizesBlocks.innerHTML = "";
  SIZES.forEach(sz => {
    if (!state.tamanhos[sz].active) return;

    const block = document.createElement("div");
    block.className = "size-block";

    const title = document.createElement("div");
    title.innerHTML = `<strong>Tamanho ${sz}</strong> · Upload de estampas (múltiplas imagens)`;
    block.appendChild(title);

    // Input de arquivos (múltiplo)
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.addEventListener("change", (e) => handleUploadFiles(sz, e.target.files));
    block.appendChild(input);

    const help = document.createElement("div");
    help.className = "help";
    help.textContent = "As imagens serão enviadas para o Storage do Supabase e os links públicos serão salvos neste produto.";
    block.appendChild(help);

    // Área de thumbs
    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";
    thumbs.dataset.size = sz;
    // render thumbs já enviadas
    state.tamanhos[sz].uploads.forEach(u => thumbs.appendChild(makeThumb(u, sz)));
    block.appendChild(thumbs);

    sizesBlocks.appendChild(block);
  });
}

function makeThumb(upload, sz) {
  const d = document.createElement("div");
  d.className = "thumb";
  const img = document.createElement("img");
  img.src = upload.url;
  img.alt = upload.name;
  const rm = document.createElement("button");
  rm.textContent = "x";
  rm.title = "Remover desta lista";
  rm.addEventListener("click", () => {
    state.tamanhos[sz].uploads = state.tamanhos[sz].uploads.filter(x => x.path !== upload.path);
    // re-render thumbs do bloco
    renderSizeBlocks();
    renderPreview();
  });
  d.appendChild(img);
  d.appendChild(rm);
  return d;
}

// ===== Upload =====
async function handleUploadFiles(sizeKey, fileList) {
  if (!state.nome.trim()) {
    setStatus("Informe o nome do produto antes de enviar imagens.", "err");
    return;
  }
  const productSlug = slugify(state.nome);
  const uploads = Array.from(fileList || []);
  if (uploads.length === 0) return;

  setStatus(`Enviando ${uploads.length} arquivo(s) para ${sizeKey}...`);

  for (const file of uploads) {
    const ts = Date.now();
    const path = `${productSlug}/${sizeKey}/${ts}-${file.name}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: false, contentType: file.type || "image/*"
    });
    if (upErr) {
      console.error(upErr);
      setStatus(`Falha ao enviar "${file.name}": ${upErr.message}`, "err");
      continue;
    }
    // URL pública
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const url = pub?.publicUrl;
    state.tamanhos[sizeKey].uploads.push({ name: file.name, path, url });
  }

  renderSizeBlocks();
  renderPreview();
  setStatus("Upload concluído.", "ok");
}

// ===== Salvar produto =====
document.getElementById("btnSalvar").addEventListener("click", saveProduct);
document.getElementById("btnPreview").addEventListener("click", renderPreview);

async function saveProduct() {
  const payload = buildPayload();

  // validação simples
  if (!payload.nome) return setStatus("Informe o nome do produto.", "err");
  if (!payload.preco || Number.isNaN(payload.preco)) return setStatus("Preço inválido.", "err");

  setStatus("Salvando produto...");

  // Tabela esperada no Supabase:
  // products (id uuid default gen_random_uuid(), nome text, preco numeric, descricao text, modelo_url text, tamanhos jsonb, created_at timestamp default now())
  // Você pode criar depois; por ora, tentamos inserir.
  const { data, error } = await supabase
    .from("products")
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error(error);
    setStatus(`Falha ao salvar no Supabase: ${error.message}`, "err");
    // Mantém o preview para você criar a tabela e tentar novamente
    return;
  }

  setStatus("Produto salvo com sucesso!", "ok");
  // limpa uploads e mantém nome/preço/descrição se quiser
  // aqui vou limpar tudo para um novo cadastro
  Object.keys(state.tamanhos).forEach(k => { state.tamanhos[k] = { active:false, uploads:[] }; });
  state.nome = ""; state.preco = ""; state.descricao = ""; state.modeloUrl = "";
  document.getElementById("nome").value = "";
  document.getElementById("preco").value = "";
  document.getElementById("descricao").value = "";
  document.getElementById("modeloUrl").value = "";
  renderSizesBar();
  renderSizeBlocks();
  renderPreview();
}

// inicialização
renderSizesBar();
renderSizeBlocks();
renderPreview();
