/**
 * @file app.js
 * @description Script principal para o e-commerce Arenza, com sistema de autenticação Supabase + cadastro com upload por tamanho.
 * Mantém compatibilidade com size_variants (string JSON, objeto, ou array), e adiciona painel integrado de upload por tamanho.
 * @version 4.1
 */

document.addEventListener('DOMContentLoaded', () => {

  // --------------------------------------------------
  // ---- 1. SELETORES DO DOM E ESTADO INICIAL
  // --------------------------------------------------
  let dbClient;
  let currentUser = null;
  let productsCache = [];

  const testimonials = [
    { quote: "As peças são ainda mais bonitas pessoalmente. Qualidade impecável e caimento perfeito!", author: "Juliana S." },
    { quote: "Recebi minha encomenda super rápido e amei a embalagem. Me senti especial. Recomendo!", author: "Fernanda L." },
    { quote: "Nunca me senti tão confiante. A Arenza entende o corpo feminino como ninguém. Virou minha marca preferida.", author: "Carla M." }
  ];

  let ADMIN_EMAIL;
  const VARIANT_FIELD_KEY = 'size_variants';
  const REMOTE_CONFIG_ENDPOINTS = [
    '/api/get-config',
    '/.netlify/functions/get-config'
  ];

  // NOVO: configuração de tamanhos e bucket de imagens
  const SIZES = ["P", "M", "G", "GG", "G1", "G2"];
  const STORAGE_BUCKET = "products";

  // Seletores do DOM (originais)
  const navAdminLink = document.getElementById('nav-admin-link');
  const navLoginLink = document.getElementById('nav-login-link');
  const navLogoutLink = document.getElementById('nav-logout-link');
  const header = document.getElementById('header');
  const productGrid = document.getElementById('product-grid');
  const adminPanelSection = document.getElementById('admin-panel');
  const testimonialCarousel = document.getElementById('testimonial-carousel');

  // Modais e formulários (originais)
  const editModal = document.getElementById('edit-modal');
  const authModal = document.getElementById('auth-modal');
  const productForm = document.getElementById('product-form'); // fluxo antigo (textarea) — mantido
  const editForm = document.getElementById('edit-product-form');
  const productVariantsInput = document.getElementById('product-variants');
  const editVariantsInput = document.getElementById('edit-product-variants');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const authErrorMessage = document.getElementById('auth-error');
  const tabLinks = document.querySelectorAll('.tab-link');
  const tabContents = document.querySelectorAll('.tab-content');
  const cancelEditBtn = document.getElementById('btn-cancel-edit');

  // NOVO: seletores do painel integrado (nome, preço, etc. + upload por tamanho)
  const nomeInput = document.getElementById('nome');
  const precoInput = document.getElementById('preco');
  const descricaoInput = document.getElementById('descricao');
  const modeloUrlInput = document.getElementById('modeloUrl');
  const sizesBar = document.getElementById('sizesBar');
  const sizesBlocks = document.getElementById('sizesBlocks');
  const adminSaveBtn = document.getElementById('btnSalvar');
  const statusEl = document.getElementById('status');

  // Estado do painel integrado (upload por tamanho)
  const adminState = {
    nome: "",
    preco: "",
    descricao: "",
    modeloUrl: "",
    // { P: {active:boolean, uploads:[url,...]}, ... }
    tamanhos: Object.fromEntries(SIZES.map(sz => [sz, { active: false, uploads: [] }]))
  };

  // --------------------------------------------------
  // ---- 2. FUNÇÕES DE RENDERIZAÇÃO E UI
  // --------------------------------------------------
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.1 });

  const escapeHtml = (value) => {
    return String(value ?? "")
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const looksLikeUrl = (s) => /^https?:\/\//i.test(String(s || '').trim());

  // Normaliza uma entrada de variantes (aceita formatos antigos)
  const normalizeVariantEntry = (entry) => {
    if (!entry) return null;
    const size = (entry.size || entry.tamanho || '').toString().trim();
    if (!size) return null;
    let prints = entry.prints || entry.estampas || entry.options || entry.value;

    if (typeof prints === 'string') {
      prints = prints.split(',');
    }
    if (!Array.isArray(prints)) {
      prints = Object.values(prints || {});
    }
    const sanitizedPrints = prints
      .map(print => (print ?? '').toString().trim())
      .filter(Boolean);
    if (sanitizedPrints.length === 0) return null;
    return { size, prints: sanitizedPrints };
  };

  // Aceita: string JSON, objeto, array
  const parseVariantField = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map(normalizeVariantEntry).filter(Boolean);
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parseVariantField(parsed);
      } catch (_) {
        console.warn('Não foi possível interpretar as variantes (JSON inválido).');
        return [];
      }
    }
    if (typeof raw === 'object') {
      if ('size' in raw || 'tamanho' in raw) {
        const single = normalizeVariantEntry(raw);
        return single ? [single] : [];
      }
      return Object.entries(raw)
        .map(([size, prints]) => normalizeVariantEntry({ size, prints }))
        .filter(Boolean);
    }
    return [];
  };

  // Mantém compatibilidade com o formulário admin antigo baseado em textarea
  const parseVariantTextareaInput = (value) => {
    if (!value || !value.trim()) return [];
    const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
    const variants = [];
    lines.forEach((line) => {
      const [sizePart, printsPart] = line.split(':');
      if (!printsPart) {
        throw new Error(`Formato inválido na linha: "${line}". Use "Tamanho: Estampa 1, Estampa 2".`);
      }
      const size = sizePart.trim();
      if (!size) {
        throw new Error(`Informe o tamanho antes dos dois pontos na linha: "${line}".`);
      }
      const prints = printsPart.split(',').map(item => item.trim()).filter(Boolean);
      if (prints.length === 0) {
        throw new Error(`Adicione ao menos uma estampa para o tamanho "${size}".`);
      }
      variants.push({ size, prints });
    });
    return variants;
  };

  const formatVariantsForTextarea = (variants) => {
    if (!variants || variants.length === 0) return '';
    return variants.map(variant => `${variant.size}: ${variant.prints.join(', ')}`).join('\n');
  };

  const getProductVariants = (product) => {
    if (!product) return [];
    const raw = product[VARIANT_FIELD_KEY] || product.variants || product.variant_options;
    return parseVariantField(raw);
  };

  // Renderiza imagens se “print” for URL; senão, badges de texto (compatível com dados antigos)
  const initializeVariantControls = () => {
    if (!productGrid) return;
    productGrid.querySelectorAll('.size-select').forEach((select) => {
      const productId = parseInt(select.dataset.productId, 10);
      if (Number.isNaN(productId)) return;
      const product = productsCache.find(item => item.id === productId);
      const variants = product?.variantOptions || [];
      const printsContainer = productGrid.querySelector(`.print-options[data-product-id="${productId}"]`);
      if (!printsContainer) return;

      const renderPrints = (size) => {
        const variant = variants.find(item => item.size === size);
        if (!variant) {
          printsContainer.innerHTML = '<p class="print-empty">Estampas indisponíveis para este tamanho.</p>';
          return;
        }
        const items = variant.prints || [];
        if (items.some(looksLikeUrl)) {
          const imgs = items.map(u => `<img src="${escapeHtml(u)}" class="print-thumb" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;margin:4px;">`).join('');
          printsContainer.innerHTML = `<div class="print-list">${imgs}</div>`;
        } else {
          const badges = items.map(print => `<span class="print-badge">${escapeHtml(print)}</span>`).join('');
          printsContainer.innerHTML = `<div class="print-list">${badges}</div>`;
        }
      };

      select.addEventListener('change', (event) => {
        renderPrints(event.target.value);
      });

      if (variants.length > 0) {
        renderPrints(select.value);
      } else {
        printsContainer.innerHTML = '';
      }
    });
  };

  function updateUserInterface() {
    const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL;
    navLoginLink?.classList.toggle('hidden', !!currentUser);
    navLogoutLink?.classList.toggle('hidden', !currentUser);
    navAdminLink?.classList.toggle('hidden', !isAdmin);
    adminPanelSection?.classList.toggle('hidden', !isAdmin);
  }

  const createProductCard = (product) => {
    const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL;
    const adminActions = `
      <div class="card-actions">
        <button class="action-btn edit-btn" data-id="${product.id}" title="Editar">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>
        </button>
        <button class="action-btn delete-btn" data-id="${product.id}" title="Excluir">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
        </button>
      </div>`;

    const variants = product.variantOptions || [];
    const hasVariants = variants.length > 0;
    const selectId = `size-select-${product.id}`;
    const optionsMarkup = variants.map((variant, index) => {
      const sizeLabel = escapeHtml(variant.size);
      return `<option value="${sizeLabel}" ${index === 0 ? 'selected' : ''}>${sizeLabel}</option>`;
    }).join('');
    const variantMarkup = hasVariants ? `
      <div class="card-variants">
        <div class="variant-selector">
          <label for="${selectId}">Selecione o tamanho</label>
          <select id="${selectId}" class="size-select" data-product-id="${product.id}">
            ${optionsMarkup}
          </select>
        </div>
        <div class="print-options" data-product-id="${product.id}"></div>
      </div>` : '';

    return `
      <div class="product-card fade-in">
        ${isAdmin ? adminActions : ''}
        <img src="${escapeHtml(product.image || '')}" alt="${escapeHtml(product.name || '')}">
        <div class="card-content">
          <h3>${escapeHtml(product.name || '')}</h3>
          <p class="price">R$ ${parseFloat(product.price || 0).toFixed(2).replace('.', ',')}</p>
          <p>${escapeHtml(product.description || '')}</p>
          ${variantMarkup}
        </div>
      </div>`;
  };

  const renderProducts = () => {
    if (!productGrid) return;
    if (!productsCache || productsCache.length === 0) {
      productGrid.innerHTML = "<p>Nenhum produto encontrado na coleção.</p>";
      return;
    }
    productGrid.innerHTML = productsCache.map(createProductCard).join('');
    productGrid.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
    initializeVariantControls();
  };

  // Depoimentos
  let currentTestimonial = 0;
  const renderTestimonials = () => {
    if (!testimonialCarousel) return;
    testimonialCarousel.innerHTML = testimonials.map((t, index) => `
      <div class="testimonial-slide ${index === 0 ? 'active' : ''}">
        <blockquote>${escapeHtml(t.quote)}</blockquote>
        <footer>— ${escapeHtml(t.author)}</footer>
      </div>
    `).join('');
  };
  const nextTestimonial = () => {
    const slides = testimonialCarousel.querySelectorAll('.testimonial-slide');
    if (slides.length === 0) return;
    slides[currentTestimonial].classList.remove('active');
    currentTestimonial = (currentTestimonial + 1) % slides.length;
    slides[currentTestimonial].classList.add('active');
  };

  // --------------------------------------------------
  // ---- 3. FUNÇÕES DE DADOS (CRUD e Auth)
  // --------------------------------------------------
  const ensureDbClient = () => {
    if (dbClient) return true;
    alert('Não foi possível conectar ao banco de dados. Verifique a configuração do Supabase.');
    return false;
  };

  async function fetchProducts() {
    if (!ensureDbClient()) {
      if (productGrid) {
        productGrid.innerHTML = '<p class="connection-error">Não foi possível carregar os produtos. Revise as chaves do Supabase.</p>';
      }
      return;
    }
    try {
      const { data, error } = await dbClient.from('products').select('*').order('id', { ascending: true });
      if (error) throw error;
      productsCache = data.map(product => ({
        ...product,
        variantOptions: getProductVariants(product)
      }));
      renderProducts();
    } catch (error) {
      console.error('Erro ao buscar produtos:', error.message);
    }
  }

  async function addProduct(productData) {
    if (!ensureDbClient()) return;
    try {
      const { error } = await dbClient.from('products').insert([productData]);
      if (error) throw error;
      alert('Produto adicionado com sucesso!');
      productForm?.reset();
      await fetchProducts();
    } catch (error) {
      console.error('Erro ao adicionar produto:', error.message);
      alert('Falha ao adicionar o produto.');
    }
  }

  async function updateProduct(productId, productData) {
    if (!ensureDbClient()) return;
    try {
      const { error } = await dbClient.from('products').update(productData).eq('id', productId);
      if (error) throw error;
      alert('Produto atualizado com sucesso!');
      closeEditModal();
      await fetchProducts();
    } catch (error) {
      console.error('Erro ao atualizar produto:', error.message);
      alert('Falha ao atualizar o produto.');
    }
  }

  async function deleteProduct(productId) {
    if (!ensureDbClient()) return;
    try {
      const { error } = await dbClient.from('products').delete().eq('id', productId);
      if (error) throw error;
      alert('Produto deletado com sucesso!');
      await fetchProducts();
    } catch (error) {
      console.error('Erro ao deletar produto:', error.message);
      alert('Falha ao deletar o produto.');
    }
  }

  async function signUpNewUser(email, password) {
    if (!ensureDbClient()) return;
    const { error } = await dbClient.auth.signUp({ email, password });
    if (error) {
      showAuthError(error.message);
      return;
    }
    alert('Conta criada! Verifique seu e-mail para confirmar o cadastro.');
    closeAuthModal();
  }

  async function signInUser(email, password) {
    if (!ensureDbClient()) return;
    const { error } = await dbClient.auth.signInWithPassword({ email, password });
    if (error) {
      showAuthError('E-mail ou senha inválidos.');
      return;
    }
    closeAuthModal();
  }

  async function signOutUser() {
    if (!ensureDbClient()) return;
    const { error } = await dbClient.auth.signOut();
    if (error) {
      alert('Erro ao fazer logout: ' + error.message);
    }
  }

  // --------------------------------------------------
  // ---- 4. MODAIS E EVENTOS
  // --------------------------------------------------
  const openEditModal = (product) => {
    if (!editModal) return;
    editModal.querySelector('#edit-product-id').value = product.id;
    editModal.querySelector('#edit-product-name').value = product.name;
    editModal.querySelector('#edit-product-price').value = product.price;
    editModal.querySelector('#edit-product-description').value = product.description;
    editModal.querySelector('#edit-product-image').value = product.image;
    if (editVariantsInput) {
      editVariantsInput.value = formatVariantsForTextarea(product.variantOptions || []);
    }
    editModal.classList.add('active');
  };
  const closeEditModal = () => editModal?.classList.remove('active');
  const openAuthModal = () => authModal?.classList.add('active');
  const closeAuthModal = () => authModal?.classList.remove('active');
  const showAuthError = (message) => {
    if (!authErrorMessage) return;
    authErrorMessage.textContent = message;
    authErrorMessage.classList.remove('hidden');
  };
  const hideAuthError = () => {
    if (!authErrorMessage) return;
    authErrorMessage.textContent = '';
    authErrorMessage.classList.add('hidden');
  };

  function setupEventListeners() {
    navLoginLink?.addEventListener('click', (e) => { e.preventDefault(); openAuthModal(); });
    navLogoutLink?.addEventListener('click', (e) => { e.preventDefault(); signOutUser(); });

    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        hideAuthError();
        signInUser(loginForm.querySelector('#login-email').value, loginForm.querySelector('#login-password').value);
      });
    }
    if (signupForm) {
      signupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        hideAuthError();
        signUpNewUser(signupForm.querySelector('#signup-email').value, signupForm.querySelector('#signup-password').value);
      });
    }
    if (productForm) {
      // Mantém o fluxo antigo baseado em textarea, para compatibilidade
      productForm.addEventListener('submit', (e) => {
        e.preventDefault();
        let variantPayload = null;
        try {
          const variants = parseVariantTextareaInput(productVariantsInput?.value || '');
          variantPayload = variants.length > 0 ? JSON.stringify(variants) : null;
        } catch (error) {
          alert(error.message);
          return;
        }
        addProduct({
          name: document.getElementById('product-name').value,
          price: document.getElementById('product-price').value,
          description: document.getElementById('product-description').value,
          image: document.getElementById('product-image').value,
          [VARIANT_FIELD_KEY]: variantPayload
        });
      });
    }
    if (editForm) {
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = editForm.querySelector('#edit-product-id').value;
        let variantPayload = null;
        try {
          const variants = parseVariantTextareaInput(editVariantsInput?.value || '');
          variantPayload = variants.length > 0 ? JSON.stringify(variants) : null;
        } catch (error) {
          alert(error.message);
          return;
        }
        updateProduct(id, {
          name: editForm.querySelector('#edit-product-name').value,
          price: editForm.querySelector('#edit-product-price').value,
          description: editForm.querySelector('#edit-product-description').value,
          image: editForm.querySelector('#edit-product-image').value,
          [VARIANT_FIELD_KEY]: variantPayload
        });
      });
    }

    productGrid?.addEventListener('click', (event) => {
      const btn = event.target.closest('.action-btn');
      if (!btn) return;
      const id = parseInt(btn.dataset.id);
      if (btn.classList.contains('delete-btn')) {
        if (confirm('Tem certeza que deseja excluir este produto?')) deleteProduct(id);
      } else if (btn.classList.contains('edit-btn')) {
        const productToEdit = productsCache.find(p => p.id === id);
        if (productToEdit) openEditModal(productToEdit);
      }
    });

    tabLinks.forEach(tab => {
      tab.addEventListener('click', () => {
        hideAuthError();
        tabLinks.forEach(item => item.classList.remove('active'));
        tabContents.forEach(item => item.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    authModal?.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });
    editModal?.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
    cancelEditBtn?.addEventListener('click', closeEditModal);

    window.addEventListener('scroll', () => header?.classList.toggle('scrolled', window.scrollY > 50));

    // NOVO: listeners do painel integrado
    if (nomeInput)   nomeInput.addEventListener('input', e => adminState.nome = e.target.value);
    if (precoInput)  precoInput.addEventListener('input', e => adminState.preco = e.target.value);
    if (descricaoInput) descricaoInput.addEventListener('input', e => adminState.descricao = e.target.value);
    if (modeloUrlInput) modeloUrlInput.addEventListener('input', e => adminState.modeloUrl = e.target.value);
    if (adminSaveBtn) adminSaveBtn.addEventListener('click', handleAdminSave);
  }

  // --------------------------------------------------
  // ---- 5. PAINEL INTEGRADO: UPLOAD POR TAMANHO
  // --------------------------------------------------
  function setAdminStatus(msg, kind = "muted") {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = kind === "ok" ? "#059669" : kind === "err" ? "#dc2626" : "#4b5563";
  }

  function renderSizesBar() {
    if (!sizesBar) return;
    sizesBar.innerHTML = "";
    SIZES.forEach(sz => {
      const btn = document.createElement("button");
      btn.className = "size-btn";
      btn.textContent = sz;
      if (adminState.tamanhos[sz].active) btn.classList.add("active");
      btn.onclick = () => toggleAdminSize(sz, btn);
      sizesBar.appendChild(btn);
    });
    renderSizeBlocks();
  }

  function toggleAdminSize(sz, btn) {
    adminState.tamanhos[sz].active = !adminState.tamanhos[sz].active;
    btn.classList.toggle("active", adminState.tamanhos[sz].active);
    renderSizeBlocks();
  }

  function renderSizeBlocks() {
    if (!sizesBlocks) return;
    sizesBlocks.innerHTML = "";
    SIZES.forEach(sz => {
      if (!adminState.tamanhos[sz].active) return;
      const block = document.createElement("div");
      block.style.border = "1px dashed #d1d5db";
      block.style.borderRadius = "10px";
      block.style.padding = "10px";
      block.style.marginBottom = "10px";

      const title = document.createElement("div");
      title.innerHTML = `<strong>Tamanho ${sz}</strong> · Upload de estampas`;
      block.appendChild(title);

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.addEventListener("change", (e) => handleUploadFiles(sz, e.target.files));
      block.appendChild(input);

      const thumbs = document.createElement("div");
      thumbs.id = `thumbs-${sz}`;
      thumbs.className = "thumbs";
      thumbs.style.display = "flex";
      thumbs.style.flexWrap = "wrap";
      thumbs.style.gap = "8px";
      thumbs.style.marginTop = "8px";
      // render existentes
      adminState.tamanhos[sz].uploads.forEach(url => {
        const img = document.createElement("img");
        img.src = url;
        img.style.width = "70px";
        img.style.height = "70px";
        img.style.objectFit = "cover";
        img.style.borderRadius = "6px";
        img.style.border = "1px solid #e5e7eb";
        thumbs.appendChild(img);
      });

      block.appendChild(thumbs);
      sizesBlocks.appendChild(block);
    });
  }

  async function handleUploadFiles(sizeKey, fileList) {
    if (!adminState.nome.trim()) {
      setAdminStatus("Informe o nome do produto antes de enviar imagens.", "err");
      return;
    }
    if (!fileList || fileList.length === 0) return;

    setAdminStatus(`Enviando ${fileList.length} arquivo(s) para ${sizeKey}...`);
    const slug = adminState.nome
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    for (const file of Array.from(fileList)) {
      const path = `${slug}/${sizeKey}/${Date.now()}-${file.name}`;
      const { error: upErr } = await dbClient.storage.from(STORAGE_BUCKET).upload(path, file, {
        upsert: false,
        contentType: file.type || "image/*"
      });
      if (upErr) {
        console.error(upErr);
        setAdminStatus(`Falha ao enviar "${file.name}": ${upErr.message}`, "err");
        continue;
      }
      const { data: pub } = dbClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      const url = pub?.publicUrl;
      if (url) {
        adminState.tamanhos[sizeKey].uploads.push(url);
        // atualiza thumbs imediatamente
        const t = document.getElementById(`thumbs-${sizeKey}`);
        if (t) {
          const img = document.createElement("img");
          img.src = url;
          img.style.width = "70px";
          img.style.height = "70px";
          img.style.objectFit = "cover";
          img.style.borderRadius = "6px";
          img.style.border = "1px solid #e5e7eb";
          t.appendChild(img);
        }
      }
    }
    setAdminStatus("Upload concluído.", "ok");
  }

  function buildVariantsFromAdminState() {
    // Converte adminState.tamanhos -> array compatível com size_variants
    // Ex: [{ size: "P", prints: ["url1","url2"]}, ...]
    const out = [];
    for (const sz of SIZES) {
      const { active, uploads } = adminState.tamanhos[sz];
      if (active && uploads && uploads.length) {
        out.push({ size: sz, prints: uploads.slice() });
      }
    }
    return out;
  }

  async function handleAdminSave() {
    // validação simples
    if (!dbClient) { alert("Sem conexão com Supabase."); return; }
    const nome = (nomeInput?.value || "").trim();
    const preco = parseFloat(precoInput?.value || "0");
    const descricao = (descricaoInput?.value || "").trim();
    const modeloUrl = (modeloUrlInput?.value || "").trim();
    if (!nome) { setAdminStatus("Informe o nome do produto.", "err"); return; }
    if (!preco || Number.isNaN(preco)) { setAdminStatus("Informe um preço válido.", "err"); return; }

    // monta payload compatível com o schema atual (name, price, description, image, size_variants)
    const sizeVariants = buildVariantsFromAdminState();
    const productData = {
      name: nome,
      price: preco,
      description: descricao,
      image: modeloUrl,
      [VARIANT_FIELD_KEY]: sizeVariants.length ? sizeVariants : null
    };

    setAdminStatus("Salvando produto...");
    try {
      const { error } = await dbClient.from('products').insert([productData]);
      if (error) throw error;
      setAdminStatus("Produto salvo com sucesso!", "ok");

      // limpa estado e UI
      adminState.nome = "";
      adminState.preco = "";
      adminState.descricao = "";
      adminState.modeloUrl = "";
      Object.keys(adminState.tamanhos).forEach(k => adminState.tamanhos[k] = { active: false, uploads: [] });
      if (nomeInput) nomeInput.value = "";
      if (precoInput) precoInput.value = "";
      if (descricaoInput) descricaoInput.value = "";
      if (modeloUrlInput) modeloUrlInput.value = "";
      renderSizesBar();
      await fetchProducts();
    } catch (err) {
      console.error(err);
      setAdminStatus("Erro ao salvar produto: " + err.message, "err");
    }
  }

  // --------------------------------------------------
  // ---- 6. INICIALIZAÇÃO DA APLICAÇÃO
  // --------------------------------------------------
  function setupFadeIns() {
    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
  }

  const renderBase = () => {
    renderTestimonials();
    setupFadeIns();
    setInterval(nextTestimonial, 5000);
    // Render da barra de tamanhos do painel integrado
    renderSizesBar();
  };

  async function resolveRemoteConfig() {
    for (const endpoint of REMOTE_CONFIG_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (!response.ok) continue;
        const config = await response.json();
        if (config?.url && config?.anonKey) {
          return config;
        }
      } catch (error) {
        console.warn(`Falha ao carregar configuração em ${endpoint}:`, error);
      }
    }
    throw new Error('Não foi possível carregar as chaves do Supabase.');
  }

  async function main() {
    setupEventListeners();
    renderBase();

    try {
      // Ambiente de desenvolvimento (local) - verifica config.js (compatível com seu fluxo)
      if (typeof SUPABASE_CONFIG !== 'undefined') {
        ADMIN_EMAIL = SUPABASE_CONFIG.ADMIN_EMAIL;
        dbClient = supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);
      } else {
        const config = await resolveRemoteConfig();
        ADMIN_EMAIL = config.adminEmail;
        dbClient = supabase.createClient(config.url, config.anonKey);
      }
    } catch (error) {
      console.error('Erro Crítico - Falha ao inicializar o Supabase:', error.message);
      if (productGrid) {
        productGrid.innerHTML = '<p class="connection-error">Não foi possível conectar ao banco de dados. Configure o endpoint /api/get-config na Vercel ou o /.netlify/functions/get-config.</p>';
      }
      return;
    }

    dbClient.auth.onAuthStateChange((event, session) => {
      currentUser = session?.user || null;
      updateUserInterface();
      fetchProducts();
    });
  }

  main(); // Ponto de partida da aplicação
});
