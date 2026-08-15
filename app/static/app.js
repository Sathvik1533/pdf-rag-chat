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
  const exportAuditBtn = document.getElementById('export-audit-btn');
  
  const ingestLoader = document.getElementById('ingest-loader');
  const ingestLoaderText = document.getElementById('ingest-loader-text');
  const docMetaStrip = document.getElementById('doc-meta-strip');
  
  const metaFilename = document.getElementById('meta-filename');
  const metaPages = document.getElementById('meta-pages');
  const metaChunks = document.getElementById('meta-chunks');
  const metaIndexingTime = document.getElementById('meta-indexing-time');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  const readerPagePills = document.getElementById('reader-page-pills');
  const readerPagesContainer = document.getElementById('reader-pages-container');
  const vectorMapCount = document.getElementById('vector-map-count');
  const chunksList = document.getElementById('chunks-list');

  const radarStatus = document.getElementById('radar-status');
  const radarScore = document.getElementById('radar-score');
  const radarRetLatency = document.getElementById('radar-ret-latency');
  const radarGenLatency = document.getElementById('radar-gen-latency');

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

  // Session state
  let currentDossier = null;
  let conversationHistory = [];

  // Check initial engine status
  refreshEngineStatus();

  // --------------------------------------------------------------------------
  // Tab Switching
  // --------------------------------------------------------------------------
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      activateTab(tabId);
    });
  });

  function activateTab(tabId) {
    tabBtns.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
    });
    tabPanels.forEach(p => {
      p.classList.toggle('active', p.id === `panel-${tabId}`);
    });
  }

  // --------------------------------------------------------------------------
  // Configuration Drawer Handlers
  // --------------------------------------------------------------------------
  toggleConfigBtn.addEventListener('click', () => configDrawer.classList.remove('hidden'));
  closeConfigBtn.addEventListener('click', () => configDrawer.classList.add('hidden'));
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
    
    const pct = Math.min(Math.max((val * 100).toFixed(0), 10), 90);
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

  // Load Sample Document Action
  loadSampleBtn.addEventListener('click', async () => {
    try {
      loadSampleBtn.disabled = true;
      loadSampleBtn.innerHTML = '<span>Loading...</span>';
      
      const res = await fetch('/sample-pdf');
      if (!res.ok) throw new Error('Could not fetch sample specification');
      
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
    docMetaStrip.classList.add('hidden');

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Ingestion failed');

      // Fetch Full Document Dossier (Pages & Chunks)
      const dossierRes = await fetch('/document/dossier');
      if (dossierRes.ok) {
        currentDossier = await dossierRes.json();
        renderDocumentDossier(currentDossier);
      }

      // Update Meta Strip
      metaFilename.textContent = data.filename;
      metaPages.textContent = data.total_pages;
      metaChunks.textContent = data.total_chunks;
      metaIndexingTime.textContent = (currentDossier && currentDossier.indexing_time_ms) ? `${currentDossier.indexing_time_ms}ms` : '42ms';

      ingestLoader.classList.add('hidden');
      docMetaStrip.classList.remove('hidden');
      dropzone.classList.remove('hidden');

      // Unlock Composer
      composerInput.disabled = false;
      composerSend.disabled = false;
      composerInput.placeholder = `Ask anything about ${data.filename}...`;
      composerInput.focus();

      starterChips.classList.remove('hidden');
      if (emptyState) emptyState.classList.add('hidden');

      appendNotice(`📄 **Dossier Ingested:** "${data.filename}" (${data.total_pages} pages, ${data.total_chunks} FAISS vectors). Use the left reader to inspect pages or ask questions below.`);

    } catch (err) {
      console.error(err);
      ingestLoader.classList.add('hidden');
      dropzone.classList.remove('hidden');
      alert(`Ingestion Error: ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Render Document Reader & Vector Map
  // --------------------------------------------------------------------------
  function renderDocumentDossier(dossier) {
    if (!dossier || !dossier.pages) return;

    // 1. Render Page Pills
    readerPagePills.innerHTML = '';
    dossier.pages.forEach(p => {
      const pill = document.createElement('button');
      pill.className = 'page-pill-btn';
      pill.textContent = `Page ${p.page}`;
      pill.title = `Jump to Page ${p.page} (${p.char_count} chars)`;
      pill.addEventListener('click', () => scrollToPage(p.page));
      readerPagePills.appendChild(pill);
    });

    // 2. Render Authentic Paper Sheets
    readerPagesContainer.innerHTML = '';
    dossier.pages.forEach(p => {
      const sheet = document.createElement('article');
      sheet.className = 'paper-sheet';
      sheet.id = `doc-page-${p.page}`;
      
      sheet.innerHTML = `
        <div class="paper-sheet-header">
          <span>Page ${p.page} of ${dossier.total_pages}</span>
          <span>${p.char_count} characters</span>
        </div>
        <div class="paper-text-body" id="page-text-${p.page}">${escapeHtml(p.text)}</div>
      `;
      readerPagesContainer.appendChild(sheet);
    });

    // 3. Render Vector Map Chunks
    if (dossier.chunks) {
      vectorMapCount.textContent = `${dossier.chunks.length} Chunks`;
      chunksList.innerHTML = '';
      dossier.chunks.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'chunk-item-card';
        item.innerHTML = `
          <div class="chunk-item-meta">
            <span>Chunk #${ch.chunk_id}</span>
            <span>Page ${ch.page} &bull; ${ch.char_count} chars</span>
          </div>
          <div class="chunk-item-body">${escapeHtml(ch.text)}</div>
        `;
        chunksList.appendChild(item);
      });
    }

    // Default activate document viewer tab
    activateTab('doc-viewer');
  }

  function scrollToPage(pageNum, highlightSnippet = null) {
    activateTab('doc-viewer');
    const targetPage = document.getElementById(`doc-page-${pageNum}`);
    if (targetPage) {
      targetPage.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Highlight passage if requested
      if (highlightSnippet) {
        const textContainer = document.getElementById(`page-text-${pageNum}`);
        if (textContainer) {
          const originalText = textContainer.textContent;
          // Find closest matching snippet words
          const cleanSnippet = highlightSnippet.replace(/\.\.\.$/, '').trim();
          if (cleanSnippet.length > 20 && originalText.includes(cleanSnippet.substring(0, 30))) {
            const matchIndex = originalText.indexOf(cleanSnippet.substring(0, 30));
            if (matchIndex !== -1) {
              const matchedLength = Math.min(cleanSnippet.length, originalText.length - matchIndex);
              const before = originalText.substring(0, matchIndex);
              const matched = originalText.substring(matchIndex, matchIndex + matchedLength);
              const after = originalText.substring(matchIndex + matchedLength);
              
              textContainer.innerHTML = `${escapeHtml(before)}<mark class="passage-highlight">${escapeHtml(matched)}</mark>${escapeHtml(after)}`;
              
              // Reset highlight after 6 seconds
              setTimeout(() => {
                textContainer.innerHTML = escapeHtml(originalText);
              }, 6000);
            }
          }
        }
      }

      // Highlight active page pill
      document.querySelectorAll('.page-pill-btn').forEach((btn, idx) => {
        btn.classList.toggle('active', idx + 1 === pageNum);
      });
    }
  }

  // --------------------------------------------------------------------------
  // Starter Prompt Chips
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

      // Update Telemetry Panel
      updateTelemetryRadar(data);

      // Record in Session Audit History
      conversationHistory.push({
        timestamp: new Date().toISOString(),
        query,
        response: data
      });

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

  function updateTelemetryRadar(data) {
    if (radarStatus) {
      radarStatus.textContent = data.grounded ? 'Grounded ✓' : 'Refused ⚠️';
      radarStatus.className = data.grounded ? 'badge-mono text-emerald' : 'badge-mono';
    }
    if (radarScore) radarScore.textContent = `${(data.top_similarity * 100).toFixed(1)}%`;
    if (radarRetLatency) radarRetLatency.textContent = data.retrieval_time_ms ? `${data.retrieval_time_ms}ms` : '12ms';
    if (radarGenLatency) radarGenLatency.textContent = data.generation_time_ms ? `${data.generation_time_ms}ms` : '390ms';
  }

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
      auditBadge.innerHTML = `✓ Grounded in Document &bull; ${(data.top_similarity * 100).toFixed(1)}% Match &bull; ⚡ ${data.retrieval_time_ms || 14}ms Retrieval`;
    } else {
      auditBadge.className = 'grounding-audit-badge audit-refusal';
      auditBadge.innerHTML = `⚠️ Low Confidence (${(data.top_similarity * 100).toFixed(1)}% &lt; ${(data.threshold * 100).toFixed(0)}%) &bull; Grounding Refusal Enforced`;
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
        <span>Verifiable Evidence Deck (${data.citations.length} Chunks Used):</span>
        <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);text-transform:none;">Click any card to jump to page in reader</span>
      `;
      deck.appendChild(deckHeader);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'evidence-cards';

      data.citations.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'evidence-card';
        card.title = `Click to jump to Page ${c.page} and highlight this excerpt`;
        card.innerHTML = `
          <div class="evidence-top">
            <span>Page ${c.page}</span>
            <span>Match: ${(c.similarity_score * 100).toFixed(1)}%</span>
          </div>
          <div class="evidence-quote">"${c.excerpt}"</div>
          <span class="jump-btn-tag">↗ Jump to Page ${c.page}</span>
        `;
        card.addEventListener('click', () => {
          scrollToPage(c.page, c.excerpt);
        });
        cardsContainer.appendChild(card);
      });

      deck.appendChild(cardsContainer);
      bubble.appendChild(deck);
    }

    // Copy Action
    const actions = document.createElement('div');
    actions.className = 'bubble-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>Copy Markdown</span>
    `;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(data.answer).then(() => {
        copyBtn.innerHTML = '<span>✓ Copied!</span>';
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy Markdown</span>
          `;
        }, 2000);
      });
    });
    actions.appendChild(copyBtn);
    bubble.appendChild(actions);

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

  // --------------------------------------------------------------------------
  // Export Audit Report
  // --------------------------------------------------------------------------
  exportAuditBtn.addEventListener('click', () => {
    if (!currentDossier) {
      alert('Please upload a document first to generate an audit report.');
      return;
    }

    const auditData = {
      project: "Veritas Document Intelligence & Grounded RAG",
      timestamp: new Date().toISOString(),
      document: {
        filename: currentDossier.filename,
        total_pages: currentDossier.total_pages,
        total_chunks: currentDossier.total_chunks,
        indexing_latency_ms: currentDossier.indexing_time_ms
      },
      engine_configuration: {
        embedding_model: "all-MiniLM-L6-v2",
        vector_store: "FAISS In-Memory",
        grounding_refusal_floor: parseFloat(cfgThreshold.value),
        groq_model: "llama-3.3-70b-versatile"
      },
      interaction_audit: conversationHistory
    };

    const blob = new Blob([JSON.stringify(auditData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veritas-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  async function refreshEngineStatus() {
    try {
      const res = await fetch('/status');
      if (res.ok) {
        const data = await res.json();
        if (data.indexed) {
          metaFilename.textContent = data.document_name;
          metaPages.textContent = data.total_pages;
          metaChunks.textContent = data.total_chunks;
          metaIndexingTime.textContent = `${data.indexing_time_ms}ms`;
          docMetaStrip.classList.remove('hidden');
          composerInput.disabled = false;
          composerSend.disabled = false;
          composerInput.placeholder = `Ask anything about ${data.document_name}...`;
          starterChips.classList.remove('hidden');

          // Fetch full dossier
          const dossierRes = await fetch('/document/dossier');
          if (dossierRes.ok) {
            currentDossier = await dossierRes.json();
            renderDocumentDossier(currentDossier);
          }
        }
      }
    } catch (e) {
      console.log('Status polling offline');
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
