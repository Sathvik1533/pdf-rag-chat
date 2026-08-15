/**
 * VERITAS — Document Intelligence & Grounded RAG
 * Client Application Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('pdf-file-input');
  const browseBtn = document.getElementById('browse-btn');
  const loadSampleBtn = document.getElementById('load-sample-btn');
  const ingestLoader = document.getElementById('ingest-loader');
  const ingestLoaderText = document.getElementById('ingest-loader-text');
  const loadedDossier = document.getElementById('loaded-dossier');
  const dossierStatus = document.getElementById('dossier-status');
  
  const metaFilename = document.getElementById('meta-filename');
  const metaPages = document.getElementById('meta-pages');
  const metaChunks = document.getElementById('meta-chunks');

  const toggleConfigBtn = document.getElementById('toggle-config-btn');
  const configDrawer = document.getElementById('config-drawer');
  const closeConfigBtn = document.getElementById('close-config-btn');
  const cfgGroqKey = document.getElementById('cfg-groq-key');
  const cfgThreshold = document.getElementById('cfg-threshold');
  const cfgThresholdVal = document.getElementById('cfg-threshold-val');
  const telemetryThreshold = document.getElementById('telemetry-threshold');

  const chatThread = document.getElementById('chat-thread');
  const emptyState = document.getElementById('empty-state');
  const starterChips = document.getElementById('starter-chips');
  const composerForm = document.getElementById('composer-form');
  const composerInput = document.getElementById('composer-input');
  const composerSend = document.getElementById('composer-send');

  // Check current indexing status on boot
  refreshEngineStatus();

  // --------------------------------------------------------------------------
  // Configuration Drawer Handlers
  // --------------------------------------------------------------------------
  toggleConfigBtn.addEventListener('click', () => {
    configDrawer.classList.remove('hidden');
  });

  closeConfigBtn.addEventListener('click', () => {
    configDrawer.classList.add('hidden');
  });

  configDrawer.addEventListener('click', (e) => {
    if (e.target === configDrawer) configDrawer.classList.add('hidden');
  });

  cfgThreshold.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value).toFixed(2);
    cfgThresholdVal.textContent = val;
    telemetryThreshold.textContent = val;
    updateSpectrumMarker(parseFloat(val));
  });

  function updateSpectrumMarker(val) {
    const marker = document.querySelector('.threshold-marker');
    const refusalZone = document.querySelector('.zone-refusal');
    const groundedZone = document.querySelector('.zone-grounded');
    const markerText = document.querySelector('.marker-text');
    
    const pct = (val * 100).toFixed(0);
    if (marker) marker.style.left = `${pct}%`;
    if (refusalZone) refusalZone.style.width = `${pct}%`;
    if (groundedZone) groundedZone.style.width = `${100 - pct}%`;
    if (markerText) markerText.textContent = `Floor (${val})`;
  }

  // --------------------------------------------------------------------------
  // File Upload & Ingestion
  // --------------------------------------------------------------------------
  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.toLowerCase().endsWith('.pdf')) {
      ingestPdfFile(files[0]);
    } else {
      alert('Please select a valid PDF file.');
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      ingestPdfFile(e.target.files[0]);
    }
  });

  // Load Sample Document
  loadSampleBtn.addEventListener('click', async () => {
    try {
      loadSampleBtn.disabled = true;
      loadSampleBtn.innerHTML = '<span>Loading...</span>';
      
      const res = await fetch('/sample-pdf');
      if (!res.ok) throw new Error('Could not fetch sample PDF');
      
      const blob = await res.blob();
      const sampleFile = new File([blob], 'sample_project_orion.pdf', { type: 'application/pdf' });
      await ingestPdfFile(sampleFile);

    } catch (err) {
      alert(`Failed to load sample: ${err.message}`);
    } finally {
      loadSampleBtn.disabled = false;
      loadSampleBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="12" y1="18" x2="12" y2="12"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
        <span>Load Sample Doc</span>
      `;
    }
  });

  async function ingestPdfFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    // UI Loading State
    ingestLoader.classList.remove('hidden');
    ingestLoaderText.textContent = `Extracting text & vectorizing "${file.name}"...`;
    dropzone.classList.add('hidden');
    loadedDossier.classList.add('hidden');
    dossierStatus.className = 'status-indicator status-waiting';
    dossierStatus.textContent = 'Processing';

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Ingestion failed');

      // Update Dossier View
      metaFilename.textContent = data.filename;
      metaPages.textContent = data.total_pages;
      metaChunks.textContent = data.total_chunks;

      ingestLoader.classList.add('hidden');
      loadedDossier.classList.remove('hidden');
      dropzone.classList.remove('hidden');
      dossierStatus.className = 'status-indicator status-active';
      dossierStatus.textContent = 'Indexed & Ready';

      // Unlock Workspace
      composerInput.disabled = false;
      composerSend.disabled = false;
      composerInput.placeholder = `Ask anything about ${data.filename}...`;
      composerInput.focus();

      starterChips.classList.remove('hidden');
      if (emptyState) emptyState.classList.add('hidden');

      appendNotice(`📄 **Dossier Loaded:** "${data.filename}" (${data.total_pages} pages, ${data.total_chunks} indexed vector chunks). Ask any question below.`);

    } catch (err) {
      console.error(err);
      ingestLoader.classList.add('hidden');
      dropzone.classList.remove('hidden');
      dossierStatus.className = 'status-indicator status-waiting';
      dossierStatus.textContent = 'Failed';
      alert(`Ingestion Error: ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Starter Chips
  // --------------------------------------------------------------------------
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const query = chip.getAttribute('data-query');
      if (query && !composerInput.disabled) {
        composerInput.value = query;
        composerForm.dispatchEvent(new Event('submit'));
      }
    });
  });

  // --------------------------------------------------------------------------
  // Q&A Conversation Flow
  // --------------------------------------------------------------------------
  composerInput.addEventListener('input', () => {
    composerInput.style.height = 'auto';
    composerInput.style.height = Math.min(composerInput.scrollHeight, 140) + 'px';
  });

  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!composerSend.disabled && composerInput.value.trim().length > 0) {
        composerForm.dispatchEvent(new Event('submit'));
      }
    }
  });

  composerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = composerInput.value.trim();
    if (!query) return;

    // Reset input state
    composerInput.value = '';
    composerInput.style.height = 'auto';
    composerInput.disabled = true;
    composerSend.disabled = true;

    // Append User Message
    appendUserBubble(query);

    // Append Assistant Loading Indicator
    const loaderId = 'loading-' + Date.now();
    appendLoadingBubble(loaderId);

    try {
      const payload = {
        question: query,
        groq_api_key: cfgGroqKey.value.trim() || undefined,
        threshold: parseFloat(cfgThreshold.value),
      };

      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      removeLoadingBubble(loaderId);

      if (!response.ok) {
        appendNotice(`❌ **Engine Error:** ${data.detail || 'Failed to generate response'}`);
        return;
      }

      appendAssistantBubble(data);

    } catch (err) {
      removeLoadingBubble(loaderId);
      appendNotice(`❌ **Network Error:** ${err.message}`);
    } finally {
      composerInput.disabled = false;
      composerSend.disabled = false;
      composerInput.focus();
    }
  });

  // --------------------------------------------------------------------------
  // Message Rendering Functions
  // --------------------------------------------------------------------------
  function appendUserBubble(text) {
    if (emptyState) emptyState.classList.add('hidden');

    const row = document.createElement('div');
    row.className = 'msg-row msg-user';

    const senderTag = document.createElement('div');
    senderTag.className = 'msg-sender-tag';
    senderTag.textContent = 'Query';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    row.appendChild(senderTag);
    row.appendChild(bubble);
    chatThread.appendChild(row);
    scrollStreamToBottom();
  }

  function appendAssistantBubble(data) {
    if (emptyState) emptyState.classList.add('hidden');

    const row = document.createElement('div');
    row.className = 'msg-row msg-assistant';

    const senderTag = document.createElement('div');
    senderTag.className = 'msg-sender-tag';
    senderTag.textContent = 'Veritas Synthesis';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    // Grounding Audit Pill
    const auditBadge = document.createElement('div');
    if (data.grounded) {
      auditBadge.className = 'grounding-audit-badge audit-grounded';
      auditBadge.innerHTML = `✓ Grounded in Document (${(data.top_similarity * 100).toFixed(1)}% Confidence Match)`;
    } else {
      auditBadge.className = 'grounding-audit-badge audit-refusal';
      auditBadge.innerHTML = `⚠️ Low Confidence (${(data.top_similarity * 100).toFixed(1)}% &lt; ${(data.threshold * 100).toFixed(0)}%) — Grounding Refusal Enforced`;
    }
    bubble.appendChild(auditBadge);

    // Answer Markdown Body
    const markdownBody = document.createElement('div');
    markdownBody.className = 'answer-body';
    markdownBody.innerHTML = window.marked ? marked.parse(data.answer) : data.answer;
    bubble.appendChild(markdownBody);

    // Evidence Deck (Citations)
    if (data.grounded && data.citations && data.citations.length > 0) {
      const deck = document.createElement('div');
      deck.className = 'evidence-deck';

      const deckHeader = document.createElement('div');
      deckHeader.className = 'evidence-header';
      deckHeader.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <span>Verifiable Evidence Deck (${data.citations.length} Chunks Used):</span>
      `;
      deck.appendChild(deckHeader);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'evidence-cards';

      data.citations.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'evidence-card';
        card.innerHTML = `
          <div class="evidence-top">
            <span>Page ${c.page}</span>
            <span>Match: ${(c.similarity_score * 100).toFixed(1)}%</span>
          </div>
          <div class="evidence-quote">"${c.excerpt}"</div>
        `;
        cardsContainer.appendChild(card);
      });

      deck.appendChild(cardsContainer);
      bubble.appendChild(deck);
    }

    row.appendChild(senderTag);
    row.appendChild(bubble);
    chatThread.appendChild(row);
    scrollStreamToBottom();
  }

  function appendNotice(text) {
    if (emptyState) emptyState.classList.add('hidden');

    const row = document.createElement('div');
    row.className = 'msg-row msg-assistant';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = window.marked ? marked.parse(text) : text;

    row.appendChild(bubble);
    chatThread.appendChild(row);
    scrollStreamToBottom();
  }

  function appendLoadingBubble(id) {
    const row = document.createElement('div');
    row.className = 'msg-row msg-assistant';
    row.id = id;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.6rem;font-size:0.85rem;color:var(--text-secondary);">
        <div class="loader-bar" style="width:24px;height:4px;border-radius:2px;"><div class="loader-bar-progress"></div></div>
        <span>Searching semantic vector space & synthesizing answer...</span>
      </div>
    `;

    row.appendChild(bubble);
    chatThread.appendChild(row);
    scrollStreamToBottom();
  }

  function removeLoadingBubble(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function scrollStreamToBottom() {
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  async function refreshEngineStatus() {
    try {
      const res = await fetch('/status');
      if (res.ok) {
        const data = await res.json();
        if (data.indexed) {
          metaFilename.textContent = data.document_name;
          metaPages.textContent = data.total_pages;
          metaChunks.textContent = data.total_chunks;
          loadedDossier.classList.remove('hidden');
          dossierStatus.className = 'status-indicator status-active';
          dossierStatus.textContent = 'Indexed & Ready';
          composerInput.disabled = false;
          composerSend.disabled = false;
          composerInput.placeholder = `Ask anything about ${data.document_name}...`;
          starterChips.classList.remove('hidden');
        }
      }
    } catch (e) {
      console.log('Status polling offline');
    }
  }
});
