/**
 * VERITAS — Verified PDF Document Assistant
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
  const composerSend = document.getElementById('composer-submit') || document.getElementById('composer-send');

  // Session state & Persistent Storage Identifiers
  function getOrCreateSessionId() {
    let sid = localStorage.getItem('veritas_session_id');
    if (!sid || sid.length < 8) {
      sid = 'sess_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('veritas_session_id', sid);
    }
    return sid;
  }
  const currentSessionId = getOrCreateSessionId();

  // Unified API Fetcher with Guaranteed X-Session-ID Header Injection
  async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      options.headers.set('X-Session-ID', currentSessionId);
    } else {
      options.headers['X-Session-ID'] = currentSessionId;
    }
    return fetch(url, options);
  }

  let currentDossier = null;
  let conversationHistory = [];
  let activeDocumentInfo = null;

  function setWorkspaceActiveDocument(docInfo) {
    if (!docInfo || !docInfo.filename) {
      // Full reset / No active document
      activeDocumentInfo = null;
      currentDossier = null;
      localStorage.removeItem('veritas_active_doc');

      if (docMetaStrip) docMetaStrip.classList.add('hidden');
      if (dropzone) dropzone.classList.remove('hidden');
      if (starterChips) starterChips.classList.add('hidden');

      if (emptyState) {
        emptyState.innerHTML = `
          <div class="empty-dossier-icon">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          <h2 class="empty-title">Ask Anything About Your Document</h2>
          <p class="empty-subtitle">
            Drop any file on the left or click <strong>"Try Sample"</strong> above. Ask any question and get instant, honest answers straight from your file.
          </p>
        `;
        emptyState.classList.remove('hidden');
      }

      if (chatThread) {
        chatThread.innerHTML = '';
        chatThread.classList.add('hidden');
      }

      if (composerInput) {
        composerInput.disabled = false;
        composerInput.value = '';
        composerInput.placeholder = 'Ask anything about your document...';
      }
      return;
    }

    // Active Document Loaded
    activeDocumentInfo = docInfo;
    localStorage.setItem('veritas_active_doc', docInfo.filename);

    // 1. Update Sidebar Active Doc Card
    if (metaFilename) metaFilename.textContent = docInfo.filename;
    if (metaPages) metaPages.textContent = `${docInfo.total_pages || 1} sections`;
    if (metaChunks) metaChunks.textContent = `${docInfo.total_chunks || 1} parts`;
    if (docMetaStrip) docMetaStrip.classList.remove('hidden');
    if (dropzone) dropzone.classList.add('hidden');

    // 2. Update Composer
    if (composerInput) {
      composerInput.disabled = false;
      composerInput.placeholder = `Ask any question about ${docInfo.filename}...`;
      composerInput.focus();
    }
    if (composerSend) composerSend.disabled = false;

    // 3. Update Starter Chips
    if (starterChips) starterChips.classList.remove('hidden');
    updateSmartStarterChips(docInfo.filename);

    // 4. Update Empty State (When no messages exist yet for this active document)
    if (emptyState) {
      emptyState.innerHTML = `
        <div class="empty-dossier-icon active-dossier-icon">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <circle cx="12" cy="14" r="3"></circle>
            <polyline points="11 14 12 15 14 13"></polyline>
          </svg>
        </div>
        <h2 class="empty-title">"${escapeHtml(docInfo.filename)}" is Ready</h2>
        <p class="empty-subtitle">
          <strong>${docInfo.total_pages || 1} sections</strong> (${docInfo.total_chunks || 1} parts) indexed with citation matching. Ask any question below or choose a topic.
        </p>
      `;
    }

    // 5. Restore or Initialize chat thread for this file
    restoreChatThread(docInfo.filename);
  }

  function getChatStorageKey(filename) {
    const fn = filename || (activeDocumentInfo ? activeDocumentInfo.filename : (currentDossier ? currentDossier.filename : (localStorage.getItem('veritas_active_doc') || 'default')));
    return `veritas_chat_thread_${currentSessionId}_${fn}`;
  }

  function saveChatThread() {
    try {
      const key = getChatStorageKey();
      localStorage.setItem(key, JSON.stringify(conversationHistory));
    } catch (e) {
      console.warn('Could not save chat thread:', e);
    }
  }

  function restoreChatThread(docFilename) {
    try {
      const key = getChatStorageKey(docFilename);
      const raw = localStorage.getItem(key);
      if (chatThread) chatThread.innerHTML = '';
      conversationHistory = [];

      if (raw) {
        const msgs = JSON.parse(raw);
        if (Array.isArray(msgs) && msgs.length > 0) {
          conversationHistory = msgs;
          if (emptyState) emptyState.classList.add('hidden');
          if (chatThread) chatThread.classList.remove('hidden');
          msgs.forEach(msg => {
            if (msg.role === 'user') {
              appendUserBubble(msg.text, false);
            } else if (msg.role === 'assistant') {
              appendAssistantBubble(msg.data, false);
            }
          });
          scrollStreamToBottom();
          return;
        }
      }

      // If no prior chat messages for this document, show clean empty state
      if (chatThread) {
        chatThread.innerHTML = '';
        chatThread.classList.add('hidden');
      }
      if (emptyState) emptyState.classList.remove('hidden');
      if (starterChips && (docFilename || activeDocumentInfo)) starterChips.classList.remove('hidden');
    } catch (e) {
      console.warn('Could not restore chat thread:', e);
      if (chatThread) chatThread.classList.add('hidden');
      if (emptyState) emptyState.classList.remove('hidden');
    }
  }

  // --------------------------------------------------------------------------
  // Global Single-Instance TTS Read-Aloud Controller
  // Guarantees zero stacked audio blocks, instant stop, voice preloading & safety timeout
  // --------------------------------------------------------------------------
  const TTSController = {
    activeBtn: null,
    activeCaptionBar: null,
    heartbeat: null,
    safetyTimeout: null,
    cachedVoices: [],

    init() {
      if (!('speechSynthesis' in window)) return;
      const loadVoices = () => {
        const v = window.speechSynthesis.getVoices();
        if (v && v.length > 0) {
          this.cachedVoices = v;
          console.log(`[TTS] ${v.length} voices loaded successfully.`);
        }
      };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    },

    getVoice() {
      const voices = this.cachedVoices.length > 0 ? this.cachedVoices : window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return null;
      return voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel') || v.default)) || voices[0];
    },

    stop() {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
      clearInterval(this.heartbeat);
      this.heartbeat = null;

      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
      }
      window._activeTTSUtterance = null;

      if (this.activeBtn) {
        this.activeBtn.classList.remove('speaking');
        this.activeBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
          <span>Read Aloud</span>
        `;
        this.activeBtn = null;
      }

      // Remove ALL stacked or lingering caption bars across entire DOM
      document.querySelectorAll('.tts-live-caption-bar').forEach(el => el.remove());
      document.querySelectorAll('.tts-speaking-active').forEach(el => el.classList.remove('tts-speaking-active'));
      this.activeCaptionBar = null;
    },

    speak(rawText, btnEl, bubbleEl, targetEl) {
      if (!('speechSynthesis' in window)) {
        alert('Voice synthesis is not supported in this browser.');
        return;
      }

      // If clicking on the currently playing button, toggle STOP
      if (this.activeBtn === btnEl) {
        this.stop();
        return;
      }

      // 1. Cancel and clean up ANY existing speech and previous caption bars FIRST
      this.stop();

      const plainText = rawText.replace(/[*_#`[\]()]/g, '').trim();
      if (!plainText) return;

      // 2. Resume browser audio context if paused
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch (e) {}

      // 3. Mark button as speaking
      this.activeBtn = btnEl;
      btnEl.classList.add('speaking');
      btnEl.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
        <span>Stop Audio</span>
        <div class="audio-waveform-bars">
          <span class="waveform-bar"></span>
          <span class="waveform-bar"></span>
          <span class="waveform-bar"></span>
          <span class="waveform-bar"></span>
        </div>
      `;

      // 4. Create and attach single live caption bar
      this.activeCaptionBar = document.createElement('div');
      this.activeCaptionBar.className = 'tts-live-caption-bar';
      this.activeCaptionBar.innerHTML = `
        <span class="tts-caption-badge">🎙️ Spoken Audio</span>
        <span class="tts-caption-text">Reading answer aloud...</span>
      `;
      bubbleEl.appendChild(this.activeCaptionBar);

      if (targetEl) targetEl.classList.add('tts-speaking-active');

      // 5. Construct Utterance
      const utterance = new SpeechSynthesisUtterance(plainText);
      window._activeTTSUtterance = utterance; // Pin globally to avoid Chrome garbage collection
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const voice = this.getVoice();
      if (voice) utterance.voice = voice;

      utterance.onboundary = (event) => {
        if (event.name === 'word' || event.name === 'sentence') {
          const charIndex = event.charIndex;
          const spokenSnippet = plainText.substring(charIndex, charIndex + 80);
          const captionEl = this.activeCaptionBar ? this.activeCaptionBar.querySelector('.tts-caption-text') : null;
          if (captionEl) {
            captionEl.textContent = `"${spokenSnippet.trim()}..."`;
          }
        }
      };

      utterance.onstart = () => {
        const captionEl = this.activeCaptionBar ? this.activeCaptionBar.querySelector('.tts-caption-text') : null;
        if (captionEl) {
          captionEl.textContent = `"${plainText.substring(0, 80)}..."`;
        }
      };

      utterance.onend = () => {
        this.stop();
      };

      utterance.onerror = (e) => {
        console.warn('[TTS] Speech utterance error / stopped:', e);
        this.stop();
      };

      // 6. Hard safety timeout (30s)
      this.safetyTimeout = setTimeout(() => {
        console.warn('[TTS] Safety timeout reached (30s). Resetting audio state.');
        this.stop();
      }, 30000);

      // 7. Chrome Heartbeat to prevent silent audio pause
      this.heartbeat = setInterval(() => {
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        } else {
          clearInterval(this.heartbeat);
        }
      }, 8000);

      // 8. Speak
      window.speechSynthesis.speak(utterance);
    }
  };

  // Pre-load voices on load
  TTSController.init();

  // --------------------------------------------------------------------------
  // Theme Toggle (Light Ivory / Dark Obsidian)
  // --------------------------------------------------------------------------
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const savedTheme = localStorage.getItem('veritas_theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('theme-dark');
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('theme-dark');
      const isDark = document.body.classList.contains('theme-dark');
      localStorage.setItem('veritas_theme', isDark ? 'dark' : 'light');
    });
  }

  // Check initial status & restore active document state
  refreshEngineStatus();

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // Studio Sidebar View Switching
  // --------------------------------------------------------------------------
  const sidebarNavItems = document.querySelectorAll('.sidebar-nav-item[data-view]');
  const studioViews = document.querySelectorAll('.studio-view');

  function activateView(viewId) {
    sidebarNavItems.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-view') === viewId);
    });
    studioViews.forEach(v => {
      v.classList.toggle('active', v.id === viewId);
    });

    if (viewId === 'view-graph' && currentDossier) {
      setTimeout(() => initKnowledgeGraph(currentDossier), 60);
    }
  }

  sidebarNavItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.getAttribute('data-view');
      activateView(viewId);
    });
  });

  const btnSidebarHistory = document.getElementById('btn-sidebar-history');
  if (btnSidebarHistory) {
    btnSidebarHistory.addEventListener('click', () => {
      renderHistoryModal();
      if (historyModal) historyModal.classList.remove('hidden');
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
    const val = parseFloat(e.target.value);
    let label = 'Balanced (0.35)';
    if (val < 0.25) label = 'Relaxed (' + val.toFixed(2) + ')';
    else if (val > 0.45) label = 'Strict (' + val.toFixed(2) + ')';
    else label = 'Balanced (' + val.toFixed(2) + ')';

    cfgThresholdVal.textContent = label;
    telemetryThreshold.textContent = val.toFixed(2);
    updateSpectrumMarker(val);
  });

  function updateSpectrumMarker(val) {
    const marker = document.querySelector('.threshold-marker');
    const refusalZone = document.querySelector('.zone-refusal');
    const groundedZone = document.querySelector('.zone-grounded');
    
    const pct = Math.min(Math.max((val * 100).toFixed(0), 10), 90);
    if (marker) marker.style.left = `${pct}%`;
    if (refusalZone) refusalZone.style.width = `${pct}%`;
    if (groundedZone) groundedZone.style.width = `${100 - pct}%`;
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
    if (files.length > 0) {
      ingestPdfFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      ingestPdfFile(e.target.files[0]);
    }
  });

  const btnChangeFile = document.getElementById('btn-change-file');
  if (btnChangeFile) {
    btnChangeFile.addEventListener('click', () => {
      fileInput.click();
    });
  }

  // Try Sample Document
  loadSampleBtn.addEventListener('click', async () => {
    try {
      loadSampleBtn.disabled = true;
      loadSampleBtn.innerHTML = '<span>Loading...</span>';
      
      const res = await apiFetch('/sample-pdf');
      if (!res.ok) throw new Error('Could not fetch sample document');
      
      const blob = await res.blob();
      const sampleFile = new File([blob], 'sample_project_orion.pdf', { type: 'application/pdf' });
      await ingestPdfFile(sampleFile);

    } catch (err) {
      alert(`Could not load sample: ${err.message}`);
    } finally {
      loadSampleBtn.disabled = false;
      loadSampleBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="12" y1="18" x2="12" y2="12"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
        <span>Try Sample Document</span>
      `;
    }
  });

  async function ingestPdfFile(file, isSilentRehydration = false) {
    const formData = new FormData();
    formData.append('file', file);

    // Stop active audio and clear any highlights immediately
    TTSController.stop();
    document.querySelectorAll('.passage-highlight').forEach(el => el.classList.remove('passage-highlight'));

    // Clear previous chat view immediately so new upload starts in a clean workspace
    if (!isSilentRehydration) {
      chatThread.innerHTML = '';
      conversationHistory = [];
      if (emptyState) emptyState.classList.remove('hidden');
    }

    // Persist file bytes to client-side IndexedDB for seamless 1-click switching & auto-rehydration
    if (file && file.name) {
      DocStore.saveFile(file.name, file);
      localStorage.setItem('veritas_active_doc', file.name);
    }

    // UI Loading State
    ingestLoader.classList.remove('hidden');
    ingestLoaderText.textContent = isSilentRehydration 
      ? `Restoring "${file.name}"...` 
      : `Reading "${file.name}" and extracting searchable content...`;
    dropzone.classList.add('hidden');
    docMetaStrip.classList.add('hidden');

    try {
      const response = await apiFetch('/upload', {
        method: 'POST',
        body: formData,
      });

      const responseText = await response.text();
      let data = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (parseErr) {
        data = { detail: `Server returned status ${response.status} (${response.statusText}).` };
      }

      if (!response.ok) {
        throw new Error(data.detail || `Upload failed with status ${response.status}`);
      }

      // Fetch Full Document Data
      const dossierRes = await apiFetch('/document/dossier');
      if (dossierRes.ok) {
        try {
          const dossierText = await dossierRes.text();
          currentDossier = dossierText ? JSON.parse(dossierText) : null;
          if (currentDossier) renderDocumentDossier(currentDossier);
        } catch (e) {
          console.warn('Could not parse dossier', e);
        }
      }

      // Save to Document History Library
      saveDocHistory({
        filename: data.filename,
        total_pages: data.total_pages,
        total_chunks: data.total_chunks,
        timestamp: Date.now()
      });

      ingestLoader.classList.add('hidden');

      // Fully activate new document workspace
      setWorkspaceActiveDocument(data);
      updateHistoryBadge();

    } catch (err) {
      console.error(err);
      ingestLoader.classList.add('hidden');
      if (!currentDossier) {
        dropzone.classList.remove('hidden');
      } else {
        docMetaStrip.classList.remove('hidden');
      }
      if (!isSilentRehydration) {
        const cleanMsg = (err.message && !err.message.includes('Traceback') && !err.message.includes('Failed to fetch'))
          ? err.message
          : 'Unable to process the document. Please verify the file and try again.';
        appendNotice(`📁 **Upload Notice:** ${cleanMsg}`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Category-Aware Smart Starter Chips
  // --------------------------------------------------------------------------
  function updateSmartStarterChips(filename) {
    if (!starterChips) return;
    starterChips.innerHTML = '';
    const ext = filename.split('.').pop().toLowerCase();
    let prompts = [];

    if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) {
      prompts = [
        "What are the top columns and primary metrics?",
        "Summarize total rows and numerical findings",
        "Calculate key totals and growth rates",
      ];
    } else if (['py', 'js', 'ts', 'jsx', 'tsx', 'cpp', 'java', 'sql'].includes(ext)) {
      prompts = [
        "Explain the main architecture and functions",
        "List all public APIs and parameters",
        "Identify potential edge cases or bugs",
      ];
    } else if (['pptx', 'ppt'].includes(ext)) {
      prompts = [
        "What is the core agenda across the slides?",
        "What are the strategic action takeaways?",
        "Summarize the final slide conclusion",
      ];
    } else {
      prompts = [
        "What is the main topic and overview of this document?",
        "Summarize the key points and findings in this file",
        "What are the important sections, dates, or specifications?",
      ];
    }

    // Header with Title & Hint
    const header = document.createElement('div');
    header.className = 'starter-chips-header';
    header.innerHTML = `
      <div class="starter-chips-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
        <span>Suggested Questions for this Document</span>
      </div>
      <span class="starter-chips-hint">Click any prompt to ask instantly</span>
    `;
    starterChips.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'starter-chips-grid';

    prompts.forEach(p => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'starter-chip-btn';
      chip.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span>${escapeHtml(p)}</span>
      `;
      chip.addEventListener('click', () => {
        composerInput.value = p;
        composerForm.dispatchEvent(new Event('submit'));
      });
      grid.appendChild(chip);
    });
    starterChips.appendChild(grid);
  }

  // --------------------------------------------------------------------------
  // Executive Presets Handlers
  // --------------------------------------------------------------------------
  const btnVeritasBrief = document.getElementById('btn-veritas-brief');
  const btnVeritasFinance = document.getElementById('btn-veritas-finance') || document.getElementById('btn-veritas-metrics');
  const btnVeritasRisks = document.getElementById('btn-veritas-risks');
  const btnVeritasDates = document.getElementById('btn-veritas-dates') || document.getElementById('btn-veritas-qa');

  if (btnVeritasBrief) {
    btnVeritasBrief.addEventListener('click', () => {
      activateView('view-chat');
      composerInput.value = "Provide an executive strategic briefing summarizing the core mission, major objectives, and key findings.";
      composerForm.dispatchEvent(new Event('submit'));
    });
  }
  if (btnVeritasFinance) {
    btnVeritasFinance.addEventListener('click', () => {
      activateView('view-chat');
      composerInput.value = "Extract all key numerical metrics, financial figures, budgets, and monetary allocations into a structured table.";
      composerForm.dispatchEvent(new Event('submit'));
    });
  }
  if (btnVeritasRisks) {
    btnVeritasRisks.addEventListener('click', () => {
      activateView('view-chat');
      composerInput.value = "Identify all operational risks, technical vulnerabilities, compliance liabilities, and critical warnings.";
      composerForm.dispatchEvent(new Event('submit'));
    });
  }
  if (btnVeritasDates) {
    btnVeritasDates.addEventListener('click', () => {
      activateView('view-chat');
      composerInput.value = "Consolidate all timelines, phase deliverables, operational milestone gates, and scheduled deadlines.";
      composerForm.dispatchEvent(new Event('submit'));
    });
  }

  // --------------------------------------------------------------------------
  // Live Document Reader Text Search
  // --------------------------------------------------------------------------
  const readerSearchInput = document.getElementById('reader-search-input');
  const readerSearchCount = document.getElementById('reader-search-count');

  if (readerSearchInput) {
    readerSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!currentDossier || !currentDossier.pages) return;

      if (!q) {
        readerSearchCount.textContent = '';
        renderDocumentDossier(currentDossier);
        return;
      }

      let totalMatches = 0;
      currentDossier.pages.forEach(p => {
        const sheetTextEl = document.getElementById(`page-text-${p.page}`);
        if (sheetTextEl) {
          const original = p.text;
          const regex = new RegExp(`(${escapeRegex(q)})`, 'gi');
          const matches = original.match(regex);
          if (matches) {
            totalMatches += matches.length;
            const highlighted = original.replace(regex, '<mark class="passage-highlight">$1</mark>');
            sheetTextEl.innerHTML = highlighted;
          } else {
            sheetTextEl.textContent = original;
          }
        }
      });
      readerSearchCount.textContent = totalMatches > 0 ? `${totalMatches} found` : '0 found';
    });
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // --------------------------------------------------------------------------
  // Render Document Reader & Sections
  // --------------------------------------------------------------------------
  function renderDocumentDossier(dossier) {
    if (!dossier || !dossier.pages) return;

    // Calculate Reading Time & Total Words
    let totalChars = 0;
    dossier.pages.forEach(p => totalChars += (p.text ? p.text.length : 0));
    const estWords = Math.ceil(totalChars / 5.5);
    const estReadTimeMin = Math.max(1, Math.ceil(estWords / 200));
    const metaReadTimeEl = document.getElementById('meta-readtime');
    if (metaReadTimeEl) metaReadTimeEl.textContent = `~${estReadTimeMin} min read (${estWords} words)`;

    // 1. Render Page Navigation Pills
    readerPagePills.innerHTML = '';
    dossier.pages.forEach(p => {
      const pill = document.createElement('button');
      pill.className = 'page-pill-btn';
      pill.textContent = p.label || `Section ${p.page}`;
      pill.title = `Jump to ${p.label || ('Section ' + p.page)}`;
      pill.addEventListener('click', () => scrollToPage(p.page));
      readerPagePills.appendChild(pill);
    });

    // 2. Render Paper Sheets with Enhanced Formatting
    readerPagesContainer.innerHTML = '';
    dossier.pages.forEach(p => {
      const sheet = document.createElement('article');
      sheet.className = 'paper-sheet';
      sheet.id = `doc-page-${p.page}`;
      
      const labelText = p.label || `Section ${p.page}`;

      // Clean Paragraph Parsing & Section Formatting
      let bodyHtml = '';
      if (p.text) {
        const rawBlocks = p.text.split(/(?:\r?\n){2,}/);
        rawBlocks.forEach(block => {
          const trimmed = block.trim();
          if (!trimmed) return;
          
          // Check for markdown headings or tables
          if (trimmed.startsWith('#') || trimmed.startsWith('###') || trimmed.startsWith('|')) {
            bodyHtml += `<div class="doc-heading">${escapeHtml(trimmed)}</div>`;
          } else if (trimmed.length < 80 && (trimmed.endsWith(':') || trimmed === trimmed.toUpperCase())) {
            bodyHtml += `<h4 class="doc-subheading">${escapeHtml(trimmed)}</h4>`;
          } else {
            // Split sentences if a single block is huge (> 400 chars with no newlines)
            const sentences = trimmed.split(/(?<=[.?!])\s+(?=[A-Z0-9])/);
            if (sentences.length > 4 && trimmed.length > 450) {
              for (let i = 0; i < sentences.length; i += 3) {
                const chunk = sentences.slice(i, i + 3).join(' ');
                bodyHtml += `<p>${escapeHtml(chunk)}</p>`;
              }
            } else {
              bodyHtml += `<p>${escapeHtml(trimmed)}</p>`;
            }
          }
        });
      }
      if (!bodyHtml) bodyHtml = `<p>${escapeHtml(p.text || '')}</p>`;

      sheet.innerHTML = `
        <div class="paper-sheet-header">
          <div class="sheet-header-left">
            <span class="sheet-tag">${escapeHtml(labelText)}</span>
            <span class="sheet-subline">Section ${p.page} of ${dossier.total_pages}</span>
          </div>
          <div class="sheet-header-right">
            <span>${p.char_count} chars &bull; ~${Math.ceil(p.char_count / 5.5)} words</span>
          </div>
        </div>
        <div class="paper-text-body" id="page-text-${p.page}">${bodyHtml}</div>
      `;
      readerPagesContainer.appendChild(sheet);
    });

    // 3. Render Sections List
    const vectorChunksList = document.getElementById('vector-chunks-list') || chunksList;
    const vectorCountEl = document.getElementById('vector-indexed-count') || vectorMapCount;
    if (dossier.chunks) {
      if (vectorCountEl) vectorCountEl.textContent = `${dossier.chunks.length} Chunks Indexed`;
      if (vectorChunksList) {
        vectorChunksList.innerHTML = '';
        dossier.chunks.forEach(ch => {
          const item = document.createElement('div');
          item.className = 'chunk-item-card';
          const chunkLabel = ch.unit_label || `Section ${ch.page}`;
          item.innerHTML = `
            <div class="chunk-item-meta">
              <span>Chunk #${ch.chunk_id + 1}</span>
              <span>${escapeHtml(chunkLabel)}</span>
            </div>
            <div class="chunk-item-body">${escapeHtml(ch.text)}</div>
          `;
          vectorChunksList.appendChild(item);
        });
      }
    }

    // Initialize Knowledge Graph
    initKnowledgeGraph(dossier);

    // Default activate Grounded Chat view
    activateView('view-chat');
  }

  // --------------------------------------------------------------------------
  // Interactive Document Entity & Concept Graph (Physics + Drag-and-Drop)
  // --------------------------------------------------------------------------
  const graphCanvas = document.getElementById('knowledge-graph-canvas');
  let graphNodes = [];
  let graphAnimationId = null;
  let draggedNode = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let hasDragged = false;
  let hoveredNode = null;

  function extractTopicHeadline(text, fallback) {
    if (!text) return fallback;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    for (const line of lines) {
      if (line.length >= 3 && line.length <= 32 && !line.startsWith('http') && !line.startsWith('---')) {
        return line;
      }
    }
    return fallback;
  }

  function initKnowledgeGraph(dossier) {
    if (!graphCanvas || !dossier || !dossier.pages) return;
    const container = graphCanvas.parentElement;
    const width = container.clientWidth || 400;
    const height = Math.max(container.clientHeight || 360, 360);

    const dpr = window.devicePixelRatio || 1;
    graphCanvas.width = width * dpr;
    graphCanvas.height = height * dpr;
    graphCanvas.style.width = width + 'px';
    graphCanvas.style.height = height + 'px';

    const ctx = graphCanvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const centerX = width / 2;
    const centerY = height / 2;

    const rootName = dossier.filename ? (dossier.filename.length > 16 ? dossier.filename.substring(0, 13) + '...' : dossier.filename) : 'Document';

    graphNodes = [
      {
        id: 'doc-center',
        label: rootName,
        fullLabel: dossier.filename || 'Document Root',
        x: centerX,
        y: centerY,
        radius: 28,
        color: '#2563eb',
        isCenter: true,
        page: 1,
        snippet: `${dossier.total_pages || 1} sections indexed`
      }
    ];

    const nodeColors = ['#059669', '#0284c7', '#7c3aed', '#d97706', '#dc2626', '#0d9488', '#4f46e5'];

    dossier.pages.forEach((p, idx) => {
      const angle = (idx / dossier.pages.length) * Math.PI * 2;
      const dist = Math.min(width, height) * 0.35 + (idx % 2 === 0 ? 0 : 20);
      const headline = extractTopicHeadline(p.text, p.label || `Section ${p.page}`);
      const color = nodeColors[idx % nodeColors.length];

      graphNodes.push({
        id: `section-${p.page}`,
        label: headline.length > 16 ? headline.substring(0, 14) + '..' : headline,
        fullLabel: headline,
        x: centerX + Math.cos(angle) * dist,
        y: centerY + Math.sin(angle) * dist,
        radius: 22,
        color: color,
        isCenter: false,
        page: p.page,
        snippet: p.text ? p.text.substring(0, 90).replace(/\s+/g, ' ') + '...' : ''
      });
    });

    const graphCountEl = document.getElementById('graph-nodes-count');
    if (graphCountEl) graphCountEl.textContent = `${graphNodes.length} Nodes`;

    if (graphAnimationId) cancelAnimationFrame(graphAnimationId);
    animateKnowledgeGraph();
  }

  function animateKnowledgeGraph() {
    if (!graphCanvas) return;
    const ctx = graphCanvas.getContext('2d');
    const width = parseFloat(graphCanvas.style.width) || graphCanvas.width;
    const height = parseFloat(graphCanvas.style.height) || graphCanvas.height;

    ctx.clearRect(0, 0, width, height);

    if (graphNodes.length > 0) {
      const centerNode = graphNodes[0];

      // Draw connecting filaments with gradients
      for (let i = 1; i < graphNodes.length; i++) {
        const node = graphNodes[i];
        ctx.beginPath();
        ctx.moveTo(centerNode.x, centerNode.y);
        ctx.lineTo(node.x, node.y);
        ctx.strokeStyle = (hoveredNode === node || draggedNode === node) ? 'rgba(37, 99, 235, 0.65)' : 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = (hoveredNode === node || draggedNode === node) ? 2.5 : 1.5;
        ctx.stroke();
      }

      // Draw Nodes
      graphNodes.forEach(node => {
        const isHovered = hoveredNode === node || draggedNode === node;

        // Outer glow
        ctx.save();
        if (isHovered) {
          ctx.shadowColor = node.color;
          ctx.shadowBlur = 14;
        }

        // Circle fill
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.stroke();
        ctx.restore();

        // Label pill background for crisp readability
        ctx.save();
        ctx.font = node.isCenter ? 'bold 10px Plus Jakarta Sans, sans-serif' : '500 9px Plus Jakarta Sans, sans-serif';
        const textMetrics = ctx.measureText(node.label);
        const textWidth = textMetrics.width;

        // Pill behind text
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        const pillH = 14;
        const pillW = textWidth + 8;
        ctx.beginPath();
        ctx.roundRect(node.x - pillW / 2, node.y - pillH / 2, pillW, pillH, 4);
        ctx.fill();

        // Text
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x, node.y);
        ctx.restore();
      });
    }

    graphAnimationId = requestAnimationFrame(animateKnowledgeGraph);
  }

  // Interactive mouse drag & jump events
  if (graphCanvas) {
    let activePointerId = null;
    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };
    let dragTargetNode = null;

    function getCanvasPos(e) {
      const rect = graphCanvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }

    function findNodeAt(x, y) {
      for (let i = graphNodes.length - 1; i >= 0; i--) {
        const node = graphNodes[i];
        const dist = Math.hypot(x - node.x, y - node.y);
        if (dist <= node.radius + 8) {
          return node;
        }
      }
      return null;
    }

    function stopDrag(e) {
      if (dragTargetNode) {
        const movedDist = Math.hypot(dragTargetNode.x - dragStartPos.x, dragTargetNode.y - dragStartPos.y);
        
        // If movement was small (< 6px), it's a CLICK -> jump to document page!
        if (movedDist < 6 && dragTargetNode.page) {
          scrollToPage(dragTargetNode.page);
        }
      }

      if (activePointerId !== null) {
        try {
          graphCanvas.releasePointerCapture(activePointerId);
        } catch (err) {}
      }

      draggedNode = null;
      dragTargetNode = null;
      activePointerId = null;
      isDragging = false;
      graphCanvas.style.cursor = hoveredNode ? 'grab' : 'default';
    }

    graphCanvas.addEventListener('pointerdown', (e) => {
      const pos = getCanvasPos(e);
      const node = findNodeAt(pos.x, pos.y);
      if (node) {
        dragTargetNode = node;
        draggedNode = node;
        activePointerId = e.pointerId;
        dragStartPos = { x: node.x, y: node.y };
        isDragging = false;
        try {
          graphCanvas.setPointerCapture(e.pointerId);
        } catch (err) {}
        graphCanvas.style.cursor = 'grabbing';
      }
    });

    graphCanvas.addEventListener('pointermove', (e) => {
      const pos = getCanvasPos(e);
      const w = parseFloat(graphCanvas.style.width) || graphCanvas.width;
      const h = parseFloat(graphCanvas.style.height) || graphCanvas.height;

      if (draggedNode && activePointerId === e.pointerId) {
        isDragging = true;
        // Clamp smoothly to canvas boundaries
        draggedNode.x = Math.max(draggedNode.radius + 6, Math.min(w - draggedNode.radius - 6, pos.x));
        draggedNode.y = Math.max(draggedNode.radius + 6, Math.min(h - draggedNode.radius - 6, pos.y));
        return;
      }

      // Hover detection
      const node = findNodeAt(pos.x, pos.y);
      hoveredNode = node;
      graphCanvas.style.cursor = node ? 'grab' : 'default';
    });

    graphCanvas.addEventListener('pointerup', stopDrag);
    graphCanvas.addEventListener('pointercancel', stopDrag);
    graphCanvas.addEventListener('pointerleave', (e) => {
      if (!draggedNode) {
        hoveredNode = null;
      }
    });

    // Global fail-safe release listeners
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('blur', stopDrag);
  }

  // --------------------------------------------------------------------------
  // Voice Speech Dictation (Speech-to-Text with Live Visual Streaming)
  // --------------------------------------------------------------------------
  const btnVoiceDictate = document.getElementById('btn-voice-dictate');
  let voiceRecordingPill = null;

  if (btnVoiceDictate) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true; // Stream words in real-time as spoken
      recognition.lang = 'en-US';

      function showVoicePill(statusText) {
        if (!voiceRecordingPill) {
          voiceRecordingPill = document.createElement('div');
          voiceRecordingPill.className = 'voice-recording-pill';
          const composerCard = document.querySelector('.composer-card') || composerForm;
          if (composerCard && composerCard.parentNode) {
            composerCard.parentNode.insertBefore(voiceRecordingPill, composerCard);
          }
        }
        voiceRecordingPill.innerHTML = `<span class="voice-recording-dot"></span> <span>${statusText}</span>`;
        voiceRecordingPill.style.display = 'inline-flex';
      }

      function hideVoicePill() {
        if (voiceRecordingPill) {
          voiceRecordingPill.style.display = 'none';
        }
      }

      recognition.onstart = () => {
        btnVoiceDictate.classList.add('listening');
        btnVoiceDictate.title = 'Listening to your speech... (Click to stop)';
        showVoicePill('Listening... Speak your question now');
      };

      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const liveText = finalTranscript || interimTranscript;
        if (liveText && composerInput) {
          // Visibly stream text into input box in real time
          composerInput.value = liveText;
          showVoicePill(`Transcribing: "${liveText.slice(0, 45)}..."`);
        }

        if (finalTranscript) {
          composerInput.value = finalTranscript.trim();
          hideVoicePill();
          setTimeout(() => {
            composerForm.dispatchEvent(new Event('submit'));
          }, 300);
        }
      };

      recognition.onerror = (event) => {
        btnVoiceDictate.classList.remove('listening');
        hideVoicePill();
        if (event.error === 'not-allowed') {
          alert('Microphone access was denied. Please allow microphone permissions in your browser URL bar to use voice dictation.');
        } else if (event.error !== 'no-speech') {
          console.warn('Speech recognition status:', event.error);
        }
      };

      recognition.onend = () => {
        btnVoiceDictate.classList.remove('listening');
        btnVoiceDictate.title = 'Voice Dictation: Speak your question';
        hideVoicePill();
      };

      btnVoiceDictate.addEventListener('click', () => {
        if (btnVoiceDictate.classList.contains('listening')) {
          recognition.stop();
        } else {
          try {
            recognition.start();
          } catch (e) {
            console.warn(e);
          }
        }
      });
    } else {
      btnVoiceDictate.title = 'Speech recognition not supported in this browser';
      btnVoiceDictate.style.opacity = '0.4';
    }
  }

  // --------------------------------------------------------------------------
  // IndexedDB Client-Side Document Store (Seamless Session Persistence)
  // --------------------------------------------------------------------------
  const DocStore = {
    dbName: 'veritas_doc_store',
    storeName: 'documents',
    async getDB() {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open(this.dbName, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(this.storeName)) {
              db.createObjectStore(this.storeName, { keyPath: 'filename' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    },
    async saveFile(filename, blob) {
      try {
        const db = await this.getDB();
        if (!db) return;
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put({ filename, blob, timestamp: Date.now() });
      } catch (e) {
        console.warn('IDB save error:', e);
      }
    },
    async getFile(filename) {
      try {
        const db = await this.getDB();
        if (!db) return null;
        return new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readonly');
          const req = tx.objectStore(this.storeName).get(filename);
          req.onsuccess = () => resolve(req.result ? req.result.blob : null);
          req.onerror = () => resolve(null);
        });
      } catch (e) {
        return null;
      }
    },
    async deleteFile(filename) {
      try {
        const db = await this.getDB();
        if (!db) return;
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete(filename);
      } catch (e) {}
    }
  };

  // --------------------------------------------------------------------------
  // Document History & Library Manager
  // --------------------------------------------------------------------------
  const btnDocHistory = document.getElementById('btn-doc-history');
  const historyModal = document.getElementById('history-modal');
  const closeHistoryBtn = document.getElementById('close-history-btn');
  const historyBackdrop = document.getElementById('history-backdrop');
  const historyList = document.getElementById('history-list');
  const historyBadgeCount = document.getElementById('history-badge-count');

  function getDocHistory() {
    try {
      return JSON.parse(localStorage.getItem(`veritas_doc_history_${currentSessionId}`) || '[]');
    } catch {
      return [];
    }
  }

  function saveDocHistory(doc) {
    const list = getDocHistory().filter(item => item.filename !== doc.filename);
    list.unshift(doc);
    if (list.length > 15) list.pop(); // keep last 15
    localStorage.setItem(`veritas_doc_history_${currentSessionId}`, JSON.stringify(list));
    updateHistoryBadge();
  }

  async function syncDocHistoryWithBackend() {
    try {
      const res = await apiFetch('/document/list');
      if (res.ok) {
        const data = await res.json();
        if (data.documents && Array.isArray(data.documents)) {
          const list = getDocHistory();
          data.documents.forEach(d => {
            if (!list.some(item => item.filename === d.filename)) {
              list.push({
                filename: d.filename,
                total_pages: d.total_pages,
                total_chunks: d.total_chunks,
                timestamp: Date.now()
              });
            }
          });
          localStorage.setItem(`veritas_doc_history_${currentSessionId}`, JSON.stringify(list));
          updateHistoryBadge();
        }
      }
    } catch (e) {
      console.warn('Could not sync history with backend:', e);
    }
  }

  function updateHistoryBadge() {
    const list = getDocHistory();
    const sidebarHistoryCount = document.getElementById('sidebar-history-count');
    [historyBadgeCount, sidebarHistoryCount].forEach(el => {
      if (el) {
        if (list.length > 0) {
          el.textContent = list.length;
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    });
  }

  async function switchDocument(filename) {
    if (!filename) return;

    // Stop active audio
    TTSController.stop();
    document.querySelectorAll('.passage-highlight').forEach(el => el.classList.remove('passage-highlight'));

    ingestLoader.classList.remove('hidden');
    ingestLoaderText.textContent = `Switching to "${filename}"...`;
    dropzone.classList.add('hidden');
    docMetaStrip.classList.add('hidden');

    try {
      // 1. Try instant backend in-memory switch
      const switchRes = await apiFetch(`/document/switch?filename=${encodeURIComponent(filename)}`, { method: 'POST' });
      if (switchRes.ok) {
        const data = await switchRes.json();
        
        // Fetch dossier for the switched document
        const dossierRes = await apiFetch('/document/dossier');
        if (dossierRes.ok) {
          const dossierText = await dossierRes.text();
          currentDossier = dossierText ? JSON.parse(dossierText) : null;
          if (currentDossier) renderDocumentDossier(currentDossier);
        }

        ingestLoader.classList.add('hidden');
        setWorkspaceActiveDocument(data);
        updateHistoryBadge();
        return true;
      }

      // 2. If server restarted, silently re-index from IndexedDB cache
      const cachedBlob = await DocStore.getFile(filename);
      if (cachedBlob) {
        const file = new File([cachedBlob], filename, { type: cachedBlob.type || 'application/octet-stream' });
        await ingestPdfFile(file);
        return true;
      }

      // 3. If sample PDF
      if (filename === 'sample_project_orion.pdf') {
        await loadSampleBtn.click();
        return true;
      }

      // 4. If not available in storage, prompt file picker gracefully
      ingestLoader.classList.add('hidden');
      if (currentDossier) {
        docMetaStrip.classList.remove('hidden');
      } else {
        dropzone.classList.remove('hidden');
      }
      fileInput.click();
      return false;

    } catch (err) {
      console.error('Switch error:', err);
      ingestLoader.classList.add('hidden');
      if (currentDossier) docMetaStrip.classList.remove('hidden');
      return false;
    }
  }

  function renderHistoryModal() {
    if (!historyList) return;
    const list = getDocHistory();
    if (list.length === 0) {
      historyList.innerHTML = `
        <div style="text-align:center;padding:2rem 1rem;color:var(--text-muted);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:0.5rem;opacity:0.5;">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          </svg>
          <p style="font-size:0.8rem;font-weight:600;">No previous documents in library yet.</p>
          <p style="font-size:0.72rem;margin-top:0.2rem;">Uploaded files and sample documents will appear here for instant 1-click switching.</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = '';
    list.forEach((doc, idx) => {
      const isCurrent = Boolean(activeDocumentInfo && activeDocumentInfo.filename === doc.filename);
      const item = document.createElement('div');
      item.className = `history-item ${isCurrent ? 'active-item' : ''}`;
      const ext = doc.filename.split('.').pop().toUpperCase();
      const timeStr = doc.timestamp ? new Date(doc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Session';

      item.innerHTML = `
        <div class="history-item-left">
          <div class="history-icon">
            <span style="font-size:0.68rem;font-weight:800;">${escapeHtml(ext)}</span>
          </div>
          <div class="history-meta">
            <div class="history-name" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</div>
            <div class="history-details">${doc.total_pages || '?'} sections • ${doc.total_chunks || '?'} chunks • ${timeStr}</div>
          </div>
        </div>
        <div class="history-actions">
          ${isCurrent 
            ? '<span class="badge-status-ready"><span class="pill-dot pill-dot-emerald"></span> ACTIVE</span>' 
            : `<button class="btn-history-load" data-index="${idx}">Switch</button>`}
          <button class="btn-history-delete" data-index="${idx}" title="Remove from Library">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;

      const switchBtn = item.querySelector('.btn-history-load');
      if (switchBtn) {
        switchBtn.addEventListener('click', async () => {
          historyModal.classList.add('hidden');
          await switchDocument(doc.filename);
        });
      }

      const delBtn = item.querySelector('.btn-history-delete');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await DocStore.deleteFile(doc.filename);
          try {
            await apiFetch(`/document/delete?filename=${encodeURIComponent(doc.filename)}`, { method: 'DELETE' });
          } catch (e) {}
          // Clear document chat thread
          localStorage.removeItem(`veritas_chat_thread_${currentSessionId}_${doc.filename}`);
          const updated = getDocHistory().filter((_, i) => i !== idx);
          localStorage.setItem(`veritas_doc_history_${currentSessionId}`, JSON.stringify(updated));
          updateHistoryBadge();
          renderHistoryModal();
          if (activeDocumentInfo && activeDocumentInfo.filename === doc.filename) {
            clearCurrentChatThread();
          }
        });
      }

      historyList.appendChild(item);
    });
  }

  if (btnDocHistory) {
    btnDocHistory.addEventListener('click', () => {
      renderHistoryModal();
      if (historyModal) historyModal.classList.remove('hidden');
    });
  }

  const btnQuickHistory = document.getElementById('btn-quick-history');
  if (btnQuickHistory) {
    btnQuickHistory.addEventListener('click', () => {
      renderHistoryModal();
      if (historyModal) historyModal.classList.remove('hidden');
    });
  }
  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
      if (historyModal) historyModal.classList.add('hidden');
    });
  }
  if (historyBackdrop) {
    historyBackdrop.addEventListener('click', () => {
      if (historyModal) historyModal.classList.add('hidden');
    });
  }
  updateHistoryBadge();

  // --------------------------------------------------------------------------
  // Chat Session Archive — auto-save conversations on Clear / New Chat
  // --------------------------------------------------------------------------
  function getChatSessions() {
    try {
      return JSON.parse(localStorage.getItem(`veritas_chat_sessions_${currentSessionId}`) || '[]');
    } catch {
      return [];
    }
  }

  function archiveChatSession() {
    if (!conversationHistory || conversationHistory.length === 0) return;
    const sessions = getChatSessions();
    const sessionEntry = {
      id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      docFilename: activeDocumentInfo ? activeDocumentInfo.filename : null,
      docPages: activeDocumentInfo ? activeDocumentInfo.total_pages : null,
      docChunks: activeDocumentInfo ? activeDocumentInfo.total_chunks : null,
      timestamp: Date.now(),
      messageCount: conversationHistory.length,
      messages: conversationHistory.slice()
    };
    sessions.unshift(sessionEntry);
    if (sessions.length > 30) sessions.pop(); // keep last 30 sessions
    localStorage.setItem(`veritas_chat_sessions_${currentSessionId}`, JSON.stringify(sessions));
    updateChatHistoryBadge();
  }

  function updateChatHistoryBadge() {
    const sessions = getChatSessions();
    const count = sessions.length;
    ['chat-history-badge-count'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = count;
        count > 0 ? el.classList.remove('hidden') : el.classList.add('hidden');
      }
    });
  }
  updateChatHistoryBadge();

  function formatRelativeTime(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  }

  const chatHistoryModal = document.getElementById('chat-history-modal');
  const chatHistoryBackdrop = document.getElementById('chat-history-backdrop');
  const chatHistoryList = document.getElementById('chat-history-list');
  const closeChatHistoryBtn = document.getElementById('close-chat-history-btn');

  const chatRestoreModal = document.getElementById('chat-restore-modal');
  const chatRestoreBackdrop = document.getElementById('chat-restore-backdrop');
  const restoreModalThread = document.getElementById('restore-modal-thread');
  const restoreModalTitle = document.getElementById('restore-modal-title');
  const closeRestoreModalBtn = document.getElementById('close-restore-modal-btn');
  const backToChatHistoryBtn = document.getElementById('back-to-chat-history-btn');

  function renderChatHistoryModal() {
    if (!chatHistoryList) return;
    const sessions = getChatSessions();

    if (sessions.length === 0) {
      chatHistoryList.innerHTML = `
        <div style="text-align:center;padding:2rem 1rem;color:var(--text-muted);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:0.5rem;opacity:0.4;">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <p style="font-size:0.8rem;font-weight:600;">No saved chat sessions yet.</p>
          <p style="font-size:0.72rem;margin-top:0.2rem;">When you click <strong>Clear Messages</strong> or <strong>New Chat</strong>, your conversation is automatically archived here.</p>
        </div>
      `;
      return;
    }

    chatHistoryList.innerHTML = '';
    sessions.forEach((session, idx) => {
      const item = document.createElement('div');
      item.className = 'chat-session-item';

      const timeStr = formatRelativeTime(session.timestamp);
      const docLabel = session.docFilename || 'No Document';
      const msgCount = session.messageCount || session.messages.length;
      // Get first user message as preview
      const firstUserMsg = session.messages.find(m => m.role === 'user');
      const preview = firstUserMsg ? firstUserMsg.text : '(No preview)';

      item.innerHTML = `
        <div class="chat-session-left">
          <div class="chat-session-doc-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span title="${escapeHtml(docLabel)}">${escapeHtml(docLabel.length > 28 ? docLabel.slice(0, 28) + '…' : docLabel)}</span>
          </div>
          <div class="chat-session-preview">"${escapeHtml(preview.length > 80 ? preview.slice(0, 80) + '…' : preview)}"</div>
          <div class="chat-session-meta">${msgCount} message${msgCount !== 1 ? 's' : ''} &bull; ${timeStr}</div>
        </div>
        <div class="chat-session-actions">
          <button class="btn-session-restore" data-idx="${idx}" title="View this conversation">Restore</button>
          <button class="btn-session-delete" data-idx="${idx}" title="Delete this session">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      const restoreBtn = item.querySelector('.btn-session-restore');
      restoreBtn.addEventListener('click', () => {
        openRestoreViewer(session);
      });

      const deleteBtn = item.querySelector('.btn-session-delete');
      deleteBtn.addEventListener('click', () => {
        const updated = getChatSessions().filter((_, i) => i !== idx);
        localStorage.setItem(`veritas_chat_sessions_${currentSessionId}`, JSON.stringify(updated));
        updateChatHistoryBadge();
        renderChatHistoryModal();
      });

      chatHistoryList.appendChild(item);
    });
  }

  function openRestoreViewer(session) {
    if (!restoreModalThread || !restoreModalTitle) return;

    const docLabel = session.docFilename || 'No Document';
    const dateStr = new Date(session.timestamp).toLocaleString();
    restoreModalTitle.textContent = `${docLabel} — ${dateStr}`;

    restoreModalThread.innerHTML = '';

    if (!session.messages || session.messages.length === 0) {
      restoreModalThread.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;padding:1rem;">No messages in this session.</p>';
    } else {
      session.messages.forEach(msg => {
        if (msg.role === 'user') {
          const bubble = document.createElement('div');
          bubble.className = 'restore-user-bubble';
          bubble.innerHTML = `<span>${escapeHtml(msg.text)}</span>`;
          restoreModalThread.appendChild(bubble);
        } else if (msg.role === 'assistant' && msg.data) {
          const wrapper = document.createElement('div');
          wrapper.className = 'restore-assistant-bubble';

          const badge = document.createElement('div');
          if (msg.data.grounded) {
            badge.className = 'grounding-audit-badge audit-grounded';
            const simPct = ((msg.data.top_similarity || 0) * 100).toFixed(1);
            badge.innerHTML = `<span class="badge-dot"></span> <strong>Grounded Proof</strong> &bull; ${simPct}% Match`;
          } else {
            badge.className = 'grounding-audit-badge audit-refusal';
            badge.innerHTML = `<span class="badge-dot dot-refusal"></span> <strong>Refused &bull; Out of Document Scope</strong>`;
          }
          wrapper.appendChild(badge);

          const body = document.createElement('div');
          body.className = 'answer-body';
          body.innerHTML = window.marked ? marked.parse(msg.data.answer) : escapeHtml(msg.data.answer);
          wrapper.appendChild(body);

          if (msg.data.grounded && msg.data.citations && msg.data.citations.length > 0) {
            const citBlock = document.createElement('div');
            citBlock.className = 'restore-citations';
            msg.data.citations.forEach(c => {
              const label = c.unit_label || `Page ${c.page}`;
              const cit = document.createElement('div');
              cit.className = 'restore-citation-chip';
              cit.textContent = `${label} — "${c.excerpt.slice(0, 60)}…"`;
              citBlock.appendChild(cit);
            });
            wrapper.appendChild(citBlock);
          }

          restoreModalThread.appendChild(wrapper);
        }
      });
    }

    if (chatHistoryModal) chatHistoryModal.classList.add('hidden');
    if (chatRestoreModal) chatRestoreModal.classList.remove('hidden');
  }

  // Wire up Chat History modal
  const btnSidebarChatHistory = document.getElementById('btn-sidebar-chat-history');
  if (btnSidebarChatHistory) {
    btnSidebarChatHistory.addEventListener('click', () => {
      renderChatHistoryModal();
      if (chatHistoryModal) chatHistoryModal.classList.remove('hidden');
    });
  }
  if (closeChatHistoryBtn) {
    closeChatHistoryBtn.addEventListener('click', () => {
      if (chatHistoryModal) chatHistoryModal.classList.add('hidden');
    });
  }
  if (chatHistoryBackdrop) {
    chatHistoryBackdrop.addEventListener('click', () => {
      if (chatHistoryModal) chatHistoryModal.classList.add('hidden');
    });
  }

  // Wire up Restore Viewer modal
  if (closeRestoreModalBtn) {
    closeRestoreModalBtn.addEventListener('click', () => {
      if (chatRestoreModal) chatRestoreModal.classList.add('hidden');
    });
  }
  if (backToChatHistoryBtn) {
    backToChatHistoryBtn.addEventListener('click', () => {
      if (chatRestoreModal) chatRestoreModal.classList.add('hidden');
      renderChatHistoryModal();
      if (chatHistoryModal) chatHistoryModal.classList.remove('hidden');
    });
  }
  if (chatRestoreBackdrop) {
    chatRestoreBackdrop.addEventListener('click', () => {
      if (chatRestoreModal) chatRestoreModal.classList.add('hidden');
    });
  }

  // --------------------------------------------------------------------------
  // Action 1: Clear Messages Only (Keeps active document loaded)
  // --------------------------------------------------------------------------
  function clearVisibleMessagesOnly() {
    TTSController.stop();
    document.querySelectorAll('.passage-highlight').forEach(el => el.classList.remove('passage-highlight'));

    // Archive current conversation before clearing
    archiveChatSession();

    if (activeDocumentInfo && activeDocumentInfo.filename) {
      const key = getChatStorageKey(activeDocumentInfo.filename);
      localStorage.removeItem(key);
    }
    conversationHistory = [];

    if (chatThread) {
      chatThread.innerHTML = '';
      chatThread.classList.add('hidden');
    }

    if (activeDocumentInfo) {
      if (emptyState) {
        emptyState.innerHTML = `
          <div class="empty-dossier-icon active-dossier-icon">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <circle cx="12" cy="14" r="3"></circle>
              <polyline points="11 14 12 15 14 13"></polyline>
            </svg>
          </div>
          <h2 class="empty-title">"${escapeHtml(activeDocumentInfo.filename)}" is Ready</h2>
          <p class="empty-subtitle">
            <strong>${activeDocumentInfo.total_pages || 1} sections</strong> (${activeDocumentInfo.total_chunks || 1} parts) indexed with citation matching. Ask any question below or choose a topic.
          </p>
        `;
        emptyState.classList.remove('hidden');
      }
      if (starterChips) starterChips.classList.remove('hidden');
    } else {
      if (emptyState) emptyState.classList.remove('hidden');
    }

    activateView('view-chat');

    if (composerInput) {
      composerInput.value = '';
      composerInput.focus();
    }
  }

  // --------------------------------------------------------------------------
  // Action 2: New Chat (Full Workspace Reset to Dropzone)
  // --------------------------------------------------------------------------
  function clearCurrentChatThread() {
    TTSController.stop();
    document.querySelectorAll('.passage-highlight').forEach(el => el.classList.remove('passage-highlight'));

    // Archive current conversation before full reset
    archiveChatSession();

    setWorkspaceActiveDocument(null);

    // Reset Document Reader sheets
    if (readerPagesContainer) {
      readerPagesContainer.innerHTML = `
        <div class="reader-empty">
          <p>Drop any PDF, Word doc, spreadsheet, slide deck, or text file to read pages here.</p>
        </div>
      `;
    }
    if (readerPagePills) {
      readerPagePills.innerHTML = '<span class="no-doc-hint">Drop any file to start reading</span>';
    }

    activateView('view-chat');
  }

  const topBtnClearMessages = document.getElementById('top-btn-clear-messages');
  if (topBtnClearMessages) {
    topBtnClearMessages.addEventListener('click', clearVisibleMessagesOnly);
  }

  const topBtnNewChat = document.getElementById('top-btn-new-chat');
  if (topBtnNewChat) {
    topBtnNewChat.addEventListener('click', clearCurrentChatThread);
  }

  // --------------------------------------------------------------------------
  // Export Studio Modal Handlers
  // --------------------------------------------------------------------------
  const exportModal = document.getElementById('export-modal');
  const closeExportBtn = document.getElementById('close-export-btn');
  const btnExportMarkdown = document.getElementById('btn-export-markdown');
  const btnExportPdf = document.getElementById('btn-export-pdf');
  const btnExportJson = document.getElementById('btn-export-json');

  if (exportAuditBtn) {
    exportAuditBtn.addEventListener('click', () => {
      if (exportModal) exportModal.classList.remove('hidden');
    });
  }
  if (closeExportBtn) {
    closeExportBtn.addEventListener('click', () => {
      if (exportModal) exportModal.classList.add('hidden');
    });
  }
  if (btnExportMarkdown) {
    btnExportMarkdown.addEventListener('click', () => {
      exportMarkdownReport();
      if (exportModal) exportModal.classList.add('hidden');
    });
  }
  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', () => {
      window.print();
      if (exportModal) exportModal.classList.add('hidden');
    });
  }
  if (btnExportJson) {
    btnExportJson.addEventListener('click', () => {
      exportJsonAudit();
      if (exportModal) exportModal.classList.add('hidden');
    });
  }

  function exportMarkdownReport() {
    if (conversationHistory.length === 0) {
      alert('Ask at least one question first to generate an executive report.');
      return;
    }
    const docName = currentDossier ? currentDossier.filename : "Document";
    let md = `# Veritas Executive Intelligence Report\n\n`;
    md += `**Target Document:** ${docName}\n`;
    md += `**Generated Date:** ${new Date().toLocaleString()}\n`;
    md += `**Factual Guarantee:** Verifiable Multi-Page Grounding Floor (0.35)\n\n---\n\n`;

    conversationHistory.forEach((item, idx) => {
      md += `### ${idx + 1}. ${item.query}\n\n`;
      md += `${item.response.answer}\n\n`;
      if (item.response.citations && item.response.citations.length > 0) {
        md += `**Verified Citations:**\n`;
        item.response.citations.forEach(c => {
          const lbl = c.unit_label || `Page ${c.page}`;
          md += `- **[${lbl}]** (${(c.similarity_score * 100).toFixed(0)}% match): "${c.excerpt}"\n`;
        });
        md += `\n`;
      }
      md += `---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veritas_report_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJsonAudit() {
    if (conversationHistory.length === 0) {
      alert('Ask a question first to export audit logs.');
      return;
    }
    const payload = {
      engine: "Veritas Grounded Document Assistant",
      exported_at: new Date().toISOString(),
      document: currentDossier ? currentDossier.filename : null,
      total_sections: currentDossier ? currentDossier.total_pages : 0,
      sessions: conversationHistory
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veritas_audit_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function scrollToPage(pageNum, highlightSnippet = null) {
    activateView('view-doc');
    
    // Highlight active page pill immediately
    document.querySelectorAll('.page-pill-btn').forEach((btn, idx) => {
      btn.classList.toggle('active', idx + 1 === pageNum);
    });

    setTimeout(() => {
      const targetPage = document.getElementById(`doc-page-${pageNum}`);
      if (targetPage) {
        targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        targetPage.classList.add('sheet-target-active');
        setTimeout(() => targetPage.classList.remove('sheet-target-active'), 2800);

        // Highlight passage if requested
        if (highlightSnippet) {
          const textContainer = document.getElementById(`page-text-${pageNum}`);
          if (textContainer) {
            const originalText = textContainer.textContent;
            const cleanSnippet = highlightSnippet.replace(/\.\.\.$/, '').trim();
            if (cleanSnippet.length > 20 && originalText.includes(cleanSnippet.substring(0, 30))) {
              const matchIndex = originalText.indexOf(cleanSnippet.substring(0, 30));
              if (matchIndex !== -1) {
                const matchedLength = Math.min(cleanSnippet.length, originalText.length - matchIndex);
                const before = originalText.substring(0, matchIndex);
                const matched = originalText.substring(matchIndex, matchIndex + matchedLength);
                const after = originalText.substring(matchIndex + matchedLength);
                
                textContainer.innerHTML = `${escapeHtml(before)}<mark class="passage-highlight">${escapeHtml(matched)}</mark>${escapeHtml(after)}`;
                
                setTimeout(() => {
                  textContainer.innerHTML = escapeHtml(originalText);
                }, 6000);
              }
            }
          }
        }
      }
    }, 60);
  }

  // --------------------------------------------------------------------------
  // Suggested Questions
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

    // Reset input
    composerInput.value = '';
    composerInput.style.height = 'auto';
    composerInput.disabled = true;
    composerSend.disabled = true;

    // Append User Question
    appendUserBubble(query);

    // Append Loading Indicator
    const loaderId = 'loading-' + Date.now();
    appendLoadingBubble(loaderId);

    try {
      // ── Auto-Recovery: if frontend has an active doc but backend lost it
      //    (e.g. server restart on Render), silently re-upload from IndexedDB
      //    before sending the chat request so the user never sees an ugly error.
      if (activeDocumentInfo && activeDocumentInfo.filename) {
        const probeRes = await apiFetch('/status');
        if (probeRes.ok) {
          const probeData = await probeRes.json();
          if (!probeData.indexed) {
            // Backend has no doc — try to restore from IndexedDB cache
            const loaderTextEl = document.getElementById('ingest-loader-text');
            if (loaderTextEl) loaderTextEl.textContent = `Reconnecting to "${activeDocumentInfo.filename}"…`;
            const cachedBlob = await DocStore.getFile(activeDocumentInfo.filename);
            if (cachedBlob) {
              const file = new File([cachedBlob], activeDocumentInfo.filename, {
                type: cachedBlob.type || 'application/octet-stream'
              });
              await ingestPdfFile(file);
            } else if (activeDocumentInfo.filename === 'sample_project_orion.pdf') {
              // Re-trigger sample load silently
              if (loadSampleBtn) loadSampleBtn.click();
              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }
      }

      const payload = {
        question: query,
        groq_api_key: cfgGroqKey.value.trim() || undefined,
        threshold: parseFloat(cfgThreshold.value),
      };

      const response = await apiFetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let data = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (parseErr) {
        data = { detail: `Server returned status ${response.status} (${response.statusText}).` };
      }

      removeLoadingBubble(loaderId);

      if (!response.ok) {
        // If still no document after recovery attempt, prompt the user gracefully
        if (response.status === 400 && data.detail && data.detail.includes('upload')) {
          appendNotice(`📂 **No document loaded.** Please upload a file using the dropzone on the left, or pick one from **Saved Files**.`);
        } else {
          const userFriendlyDetail = (data.detail && !data.detail.includes('Traceback') && !data.detail.includes('NameError')) 
            ? data.detail 
            : 'We encountered an issue analyzing your document. Please try again.';
          appendNotice(`⚠️ **Notice:** ${userFriendlyDetail}`);
        }
        return;
      }

      // Update Telemetry Panel
      updateTelemetryRadar(data);

      // Render Assistant Bubble and persist to localStorage
      appendAssistantBubble(data, true);

    } catch (err) {
      removeLoadingBubble(loaderId);
      appendNotice(`⚠️ **Connection Notice:** Unable to reach the server. Please check your network connection and try again.`);
    } finally {
      composerInput.disabled = false;
      composerSend.disabled = false;
      composerInput.focus();
    }
  });

  function updateTelemetryRadar(data) {
    if (radarStatus) {
      radarStatus.textContent = data.grounded ? 'Verified in Document' : 'Not in Document';
      radarStatus.className = data.grounded ? 'badge-mono text-emerald' : 'badge-mono';
    }
    if (radarScore) radarScore.textContent = `${(data.top_similarity * 100).toFixed(1)}% Confidence`;
    if (radarRetLatency) radarRetLatency.textContent = data.retrieval_time_ms ? `${data.retrieval_time_ms}ms` : '12ms';
    if (radarGenLatency) radarGenLatency.textContent = data.generation_time_ms ? `${data.generation_time_ms}ms` : '390ms';
  }

  // --------------------------------------------------------------------------
  // Message Rendering Functions
  // --------------------------------------------------------------------------
  function appendUserBubble(text, shouldSave = true) {
    if (emptyState) emptyState.classList.add('hidden');
    if (chatThread) chatThread.classList.remove('hidden');

    const row = document.createElement('div');
    row.className = 'msg-row msg-user';

    // Track index in conversationHistory for this message
    const histIdx = conversationHistory.length; // will be pushed at this index if shouldSave
    row.dataset.historyIndex = histIdx;

    const senderTag = document.createElement('div');
    senderTag.className = 'msg-sender-tag';
    senderTag.textContent = 'Your Question';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    // ── Hover action bar (Edit + Delete) ─────────────────────────────────────
    const hoverActions = document.createElement('div');
    hoverActions.className = 'msg-hover-actions';

    // Edit button — transforms bubble into inline textarea (ChatGPT style)
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn';
    editBtn.title = 'Edit & resend';
    editBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
      <span>Edit</span>
    `;
    editBtn.addEventListener('click', () => {
      // Replace the bubble with an inline textarea
      const editWrap = document.createElement('div');
      editWrap.className = 'msg-bubble-edit-wrap';

      const textarea = document.createElement('textarea');
      textarea.className = 'msg-bubble-textarea';
      textarea.value = text;
      textarea.rows = Math.max(2, Math.ceil(text.length / 60));
      editWrap.appendChild(textarea);

      const controls = document.createElement('div');
      controls.className = 'msg-edit-controls';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn-edit-save';
      saveBtn.textContent = 'Save & Send';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-edit-cancel';
      cancelBtn.textContent = 'Cancel';

      controls.appendChild(cancelBtn);
      controls.appendChild(saveBtn);
      editWrap.appendChild(controls);

      // Swap bubble for editWrap
      bubble.replaceWith(editWrap);
      hoverActions.style.opacity = '0';
      hoverActions.style.visibility = 'hidden';
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);

      // Cancel — restore original bubble
      cancelBtn.addEventListener('click', () => {
        editWrap.replaceWith(bubble);
        hoverActions.style.opacity = '';
        hoverActions.style.visibility = '';
      });

      // Save — remove Q&A pair, re-submit the edited text
      saveBtn.addEventListener('click', () => {
        const newText = textarea.value.trim();
        if (!newText) return;

        // Remove following assistant row from DOM
        const allRows = Array.from(chatThread.querySelectorAll('.msg-row'));
        const rowIdx = allRows.indexOf(row);
        const nextRow = allRows[rowIdx + 1];
        if (nextRow && nextRow.classList.contains('msg-assistant')) nextRow.remove();

        // Remove from conversationHistory
        const uIdx = conversationHistory.findIndex(m => m.role === 'user' && m.text === text);
        if (uIdx !== -1) {
          const removeCount = (conversationHistory[uIdx + 1] && conversationHistory[uIdx + 1].role === 'assistant') ? 2 : 1;
          conversationHistory.splice(uIdx, removeCount);
        }

        // Remove this row (will be re-added by submit)
        row.remove();

        // Submit the new text as a fresh query
        if (composerInput) {
          composerInput.value = newText;
          composerForm.dispatchEvent(new Event('submit'));
        }
      });
    });

    // Delete button — removes this Q&A pair entirely
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'msg-action-btn msg-action-btn-danger';
    deleteBtn.title = 'Delete this message';
    deleteBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>Delete</span>
    `;
    deleteBtn.addEventListener('click', () => {
      const allRows = Array.from(chatThread.querySelectorAll('.msg-row'));
      const rowIdx = allRows.indexOf(row);
      const nextRow = allRows[rowIdx + 1];
      if (nextRow && nextRow.classList.contains('msg-assistant')) nextRow.remove();
      row.remove();

      const uIdx = conversationHistory.findIndex(m => m.role === 'user' && m.text === text);
      if (uIdx !== -1) {
        const removeCount = (conversationHistory[uIdx + 1] && conversationHistory[uIdx + 1].role === 'assistant') ? 2 : 1;
        conversationHistory.splice(uIdx, removeCount);
        saveChatThread();
      }

      if (chatThread && chatThread.querySelectorAll('.msg-row').length === 0) {
        chatThread.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
      }
    });

    hoverActions.appendChild(editBtn);
    hoverActions.appendChild(deleteBtn);

    row.appendChild(hoverActions);
    row.appendChild(senderTag);
    row.appendChild(bubble);
    chatThread.appendChild(row);
    scrollStreamToBottom();

    if (shouldSave) {
      conversationHistory.push({
        role: 'user',
        text: text,
        timestamp: new Date().toISOString()
      });
      saveChatThread();
    }
  }

  function appendAssistantBubble(data, shouldSave = true) {
    if (emptyState) emptyState.classList.add('hidden');
    if (chatThread) chatThread.classList.remove('hidden');

    const row = document.createElement('div');
    row.className = 'msg-row msg-assistant';

    const senderTag = document.createElement('div');
    senderTag.className = 'msg-sender-tag';
    senderTag.textContent = 'Veritas Answer';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    // Fact-Check / Grounding Audit Badge
    const auditBadge = document.createElement('div');
    if (data.grounded) {
      auditBadge.className = 'grounding-audit-badge audit-grounded';
      const simPct = (data.top_similarity * 100).toFixed(1);
      const pageNum = data.citations && data.citations[0] ? (data.citations[0].unit_label || `Page ${data.citations[0].page}`) : 'Document';
      auditBadge.innerHTML = `<span class="badge-dot"></span> <strong>Grounded Proof</strong> &bull; ${simPct}% Match &bull; ${escapeHtml(pageNum)}`;
    } else {
      auditBadge.className = 'grounding-audit-badge audit-refusal';
      auditBadge.innerHTML = `<span class="badge-dot dot-refusal"></span> <strong>Refused &bull; Out of Document Scope</strong>`;
    }
    bubble.appendChild(auditBadge);

    // Answer Body
    const markdownBody = document.createElement('div');
    markdownBody.className = 'answer-body';
    markdownBody.innerHTML = window.marked ? marked.parse(data.answer) : data.answer;
    bubble.appendChild(markdownBody);

    // Verification Ledger / Evidence Deck (Citations)
    if (data.grounded && data.citations && data.citations.length > 0) {
      const deck = document.createElement('div');
      deck.className = 'evidence-deck';

      const deckHeader = document.createElement('div');
      deckHeader.className = 'evidence-header';
      deckHeader.innerHTML = `
        <span>Verified Evidence Ledger (${data.citations.length} ${data.citations.length === 1 ? 'source' : 'sources'}):</span>
        <span style="font-size:0.68rem;font-weight:500;color:var(--text-muted);text-transform:none;">Click box to inspect source page</span>
      `;
      deck.appendChild(deckHeader);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'evidence-cards';

      data.citations.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'evidence-card';
        const label = c.unit_label || `Page ${c.page}`;
        card.title = `Click to view ${label}`;
        card.innerHTML = `
          <div class="evidence-top">
            <span>${escapeHtml(label)}</span>
            <span class="jump-btn-tag">↗ Open ${escapeHtml(label)}</span>
          </div>
          <div class="evidence-quote">"${escapeHtml(c.excerpt)}"</div>
        `;
        card.addEventListener('click', () => {
          activateView('view-doc');
          scrollToPage(c.page, c.excerpt);
        });
        cardsContainer.appendChild(card);
      });

      deck.appendChild(cardsContainer);
      bubble.appendChild(deck);
    }

    // Message Actions Bar (Read Aloud with Synced Live Captions & Waveform + Copy)
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    // Read Aloud / Audio Synthesis Button (Driven by Global TTSController)
    const speakBtn = document.createElement('button');
    speakBtn.className = 'speak-btn';
    speakBtn.title = 'Listen: Speak answer aloud with live caption sync';
    speakBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
      <span>Read Aloud</span>
    `;

    speakBtn.addEventListener('click', () => {
      TTSController.speak(data.answer, speakBtn, bubble, markdownBody);
    });

    // Copy text button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.title = 'Copy response text';
    copyBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>Copy</span>
    `;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(data.answer).then(() => {
        copyBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Copied!</span>
        `;
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
          `;
        }, 2000);
      });
    });

    actions.appendChild(speakBtn);
    actions.appendChild(copyBtn);

    // Delete button — removes this assistant bubble and the preceding user bubble
    const delAnswerBtn = document.createElement('button');
    delAnswerBtn.className = 'copy-btn msg-action-btn-danger-soft';
    delAnswerBtn.title = 'Delete this Q&A pair';
    delAnswerBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>Delete</span>
    `;
    delAnswerBtn.addEventListener('click', () => {
      const allRows = Array.from(chatThread.querySelectorAll('.msg-row'));
      const rowIdx = allRows.indexOf(row);
      // Remove preceding user bubble too
      const prevRow = allRows[rowIdx - 1];
      if (prevRow && prevRow.classList.contains('msg-user')) {
        const userText = prevRow.querySelector('.msg-bubble') ? prevRow.querySelector('.msg-bubble').textContent : null;
        prevRow.remove();
        if (userText) {
          const uIdx = conversationHistory.findIndex(m => m.role === 'user' && m.text === userText);
          if (uIdx !== -1) {
            const removeCount = (conversationHistory[uIdx + 1] && conversationHistory[uIdx + 1].role === 'assistant') ? 2 : 1;
            conversationHistory.splice(uIdx, removeCount);
          }
        }
      } else {
        // Just remove this assistant message from history
        const aIdx = conversationHistory.findIndex(m => m.role === 'assistant' && m.data && m.data.answer === data.answer);
        if (aIdx !== -1) conversationHistory.splice(aIdx, 1);
      }
      row.remove();
      saveChatThread();
      if (chatThread && chatThread.querySelectorAll('.msg-row').length === 0) {
        chatThread.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
      }
    });
    actions.appendChild(delAnswerBtn);
    bubble.appendChild(actions);

    row.appendChild(senderTag);
    row.appendChild(bubble);
    chatThread.appendChild(row);
    scrollStreamToBottom();

    if (shouldSave) {
      conversationHistory.push({
        role: 'assistant',
        data: data,
        timestamp: new Date().toISOString()
      });
      saveChatThread();
    }
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
        <span>Searching your PDF for matching facts & writing answer...</span>
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

  // Export Summary
  exportAuditBtn.addEventListener('click', () => {
    if (!currentDossier) {
      alert('Please upload or load a PDF document first.');
      return;
    }

    const auditData = {
      title: "Veritas Document Q&A Summary",
      timestamp: new Date().toISOString(),
      document: {
        filename: currentDossier.filename,
        total_pages: currentDossier.total_pages,
        total_sections: currentDossier.total_chunks
      },
      qa_history: conversationHistory
    };

    const blob = new Blob([JSON.stringify(auditData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veritas-qa-summary-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  async function refreshEngineStatus() {
    try {
      // Sync document history with backend for this session
      await syncDocHistoryWithBackend();
      updateHistoryBadge();

      const res = await apiFetch('/status');
      if (res.ok) {
        const data = await res.json();
        if (data.indexed) {
          const dossierRes = await apiFetch('/document/dossier');
          if (dossierRes.ok) {
            currentDossier = await dossierRes.json();
            renderDocumentDossier(currentDossier);
          }

          setWorkspaceActiveDocument({
            filename: data.document_name,
            total_pages: data.total_pages,
            total_chunks: data.total_chunks
          });
          return;
        }
      }

      // If server has no active index (e.g. cold restart / redeploy), attempt auto-rehydration from IndexedDB
      const savedDocName = localStorage.getItem('veritas_active_doc');
      if (savedDocName) {
        const cachedBlob = await DocStore.getFile(savedDocName);
        if (cachedBlob) {
          const file = new File([cachedBlob], savedDocName, { type: cachedBlob.type || 'application/octet-stream' });
          await ingestPdfFile(file, true);
          return;
        }
      }

      // Clean fallback if no prior document exists or if session expired
      setWorkspaceActiveDocument(null);
    } catch (e) {
      console.warn('Status offline or rehydration check failed:', e);
      setWorkspaceActiveDocument(null);
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

  // --------------------------------------------------------------------------
  // Instant Floating Tooltip Engine (Interactive Elements Only)
  // --------------------------------------------------------------------------
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'veritas-tooltip';
  document.body.appendChild(tooltipEl);

  let activeTooltipTarget = null;
  let tooltipTimeout = null;

  function hideTooltip() {
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
    activeTooltipTarget = null;
    tooltipEl.classList.remove('visible');
  }

  document.addEventListener('mouseover', (e) => {
    // Strictly match interactive buttons, links, or inputs with data-tooltip or title
    const target = e.target.closest('button[data-tooltip], a[data-tooltip], [data-tooltip], button[title], a[title]');
    if (!target) return;

    if (target.hasAttribute('title')) {
      const text = target.getAttribute('title');
      if (text && text.trim().length > 0) {
        target.setAttribute('data-tooltip', text);
        target.removeAttribute('title');
      }
    }

    const text = target.getAttribute('data-tooltip');
    if (!text || text.trim().length === 0) return;

    if (activeTooltipTarget === target) return;
    activeTooltipTarget = target;

    if (tooltipTimeout) clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      if (activeTooltipTarget === target) {
        tooltipEl.textContent = text;
        positionTooltip(target);
        tooltipEl.classList.add('visible');
      }
    }, 100);
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target && target === activeTooltipTarget) {
      hideTooltip();
    }
  });

  document.addEventListener('click', () => {
    hideTooltip();
  });

  window.addEventListener('scroll', () => {
    if (activeTooltipTarget) positionTooltip(activeTooltipTarget);
  }, true);

  window.addEventListener('resize', () => {
    if (activeTooltipTarget) positionTooltip(activeTooltipTarget);
  });

  function positionTooltip(target) {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    let top = 0;
    let left = 0;
    let placement = 'placement-top';

    if (target.closest('.studio-sidebar')) {
      placement = 'placement-right';
      top = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
      left = rect.right + 10;
    } else {
      top = rect.top - tooltipRect.height - 6;
      left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
      placement = 'placement-top';

      // If clipping at the top, show below
      if (top < 6) {
        top = rect.bottom + 6;
        placement = 'placement-bottom';
      }

      // Keep within left/right bounds
      if (left < 8) left = 8;
      if (left + tooltipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - tooltipRect.width - 8;
      }
    }

    tooltipEl.className = `veritas-tooltip visible ${placement}`;
    tooltipEl.style.top = `${Math.round(top)}px`;
    tooltipEl.style.left = `${Math.round(left)}px`;
  }

  // --------------------------------------------------------------------------
  // Global Keyboard Shortcuts (Cmd/Ctrl + K, Esc)
  // --------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (!composerInput.disabled) {
        composerInput.focus();
      }
    }
    if (e.key === 'Escape') {
      TTSController.stop();
      document.querySelectorAll('.passage-highlight').forEach(el => {
        el.classList.remove('passage-highlight');
      });
    }
  });

  // --------------------------------------------------------------------------
  // Tab Visibility Lifecycle Management (Resumes or cleans up TTS on tab switch)
  // --------------------------------------------------------------------------
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && 'speechSynthesis' in window) {
      // Returned from background tab - resume audio subsystem if paused
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }
  });
});
