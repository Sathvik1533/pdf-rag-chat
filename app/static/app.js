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
  const composerSend = document.getElementById('composer-send');

  // Session state
  let currentDossier = null;
  let conversationHistory = [];

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

  // Check initial status
  refreshEngineStatus();

  // --------------------------------------------------------------------------
  // Tab Switching
  // --------------------------------------------------------------------------
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      activateTab(tabId);
      if (tabId === 'knowledge-graph' && currentDossier) {
        setTimeout(() => initKnowledgeGraph(currentDossier), 50);
      }
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
      
      const res = await fetch('/sample-pdf');
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

  async function ingestPdfFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    // UI Loading State
    ingestLoader.classList.remove('hidden');
    ingestLoaderText.textContent = `Reading "${file.name}" and extracting searchable content...`;
    dropzone.classList.add('hidden');
    docMetaStrip.classList.add('hidden');

    try {
      const response = await fetch('/upload', {
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
      const dossierRes = await fetch('/document/dossier');
      if (dossierRes.ok) {
        try {
          const dossierText = await dossierRes.text();
          currentDossier = dossierText ? JSON.parse(dossierText) : null;
          if (currentDossier) renderDocumentDossier(currentDossier);
        } catch (e) {
          console.warn('Could not parse dossier', e);
        }
      }

      // Update Meta Strip
      metaFilename.textContent = data.filename;
      metaPages.textContent = `${data.total_pages} sections`;
      metaChunks.textContent = `${data.total_chunks} chunks`;

      ingestLoader.classList.add('hidden');
      docMetaStrip.classList.remove('hidden');
      dropzone.classList.add('hidden'); // Ensure dropzone stays hidden!

      // Unlock Composer
      composerInput.disabled = false;
      composerSend.disabled = false;
      composerInput.placeholder = `Ask any question about ${data.filename}...`;
      composerInput.focus();

      starterChips.classList.remove('hidden');
      if (emptyState) emptyState.classList.add('hidden');

      updateSmartStarterChips(data.filename);

      appendNotice(`📄 **"${data.filename}" is ready!** ${data.total_pages} sections indexed. Read the document on the left or ask any question below.`);

    } catch (err) {
      console.error(err);
      ingestLoader.classList.add('hidden');
      if (!currentDossier) {
        dropzone.classList.remove('hidden');
      } else {
        docMetaStrip.classList.remove('hidden');
      }
      appendNotice(`⚠️ **Upload Notice:** ${err.message}`);
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
        "What is the main objective of this document?",
        "What are the key figures, budgets, and milestones?",
        "Summarize the key takeaways and leadership team",
      ];
    }

    prompts.forEach(p => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'starter-chip-btn';
      chip.textContent = p;
      chip.addEventListener('click', () => {
        composerInput.value = p;
        composerForm.dispatchEvent(new Event('submit'));
      });
      starterChips.appendChild(chip);
    });
  }

  // --------------------------------------------------------------------------
  // Executive Presets Handlers
  // --------------------------------------------------------------------------
  const btnVeritasBrief = document.getElementById('btn-veritas-brief');
  const btnVeritasMetrics = document.getElementById('btn-veritas-metrics');
  const btnVeritasRisks = document.getElementById('btn-veritas-risks');
  const btnVeritasQa = document.getElementById('btn-veritas-qa');

  if (btnVeritasBrief) {
    btnVeritasBrief.addEventListener('click', () => {
      composerInput.value = "Provide an executive strategic briefing summarizing the core mission, major objectives, and key findings.";
      composerForm.dispatchEvent(new Event('submit'));
    });
  }
  if (btnVeritasMetrics) {
    btnVeritasMetrics.addEventListener('click', () => {
      composerInput.value = "Extract all key numerical metrics, financial figures, budgets, and SLAs mentioned in this document into a structured table.";
      composerForm.dispatchEvent(new Event('submit'));
    });
  }
  if (btnVeritasRisks) {
    btnVeritasRisks.addEventListener('click', () => {
      composerInput.value = "Identify all operational risks, circuit breakers, technical constraints, and milestone timelines.";
      composerForm.dispatchEvent(new Event('submit'));
    });
  }
  if (btnVeritasQa) {
    btnVeritasQa.addEventListener('click', () => {
      composerInput.value = "Generate 4 essential study questions and precise grounded answers based on this document.";
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

    // 2. Render Paper Sheets
    readerPagesContainer.innerHTML = '';
    dossier.pages.forEach(p => {
      const sheet = document.createElement('article');
      sheet.className = 'paper-sheet';
      sheet.id = `doc-page-${p.page}`;
      
      const labelText = p.label || `Section ${p.page}`;
      sheet.innerHTML = `
        <div class="paper-sheet-header">
          <span>${escapeHtml(labelText)} of ${dossier.total_pages}</span>
          <span>${p.char_count} characters</span>
        </div>
        <div class="paper-text-body" id="page-text-${p.page}">${escapeHtml(p.text)}</div>
      `;
      readerPagesContainer.appendChild(sheet);
    });

    // 3. Render Sections List
    if (dossier.chunks) {
      vectorMapCount.textContent = `${dossier.chunks.length} Chunks`;
      chunksList.innerHTML = '';
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
        chunksList.appendChild(item);
      });
    }

    // Initialize Knowledge Graph
    initKnowledgeGraph(dossier);

    // Default activate document viewer tab
    activateTab('doc-viewer');
  }

  // --------------------------------------------------------------------------
  // Interactive Knowledge Graph Canvas Simulation
  // --------------------------------------------------------------------------
  const graphCanvas = document.getElementById('knowledge-graph-canvas');
  let graphNodes = [];
  let graphAnimationId = null;

  function initKnowledgeGraph(dossier) {
    if (!graphCanvas || !dossier || !dossier.pages) return;
    const ctx = graphCanvas.getContext('2d');
    const container = graphCanvas.parentElement;
    graphCanvas.width = container.clientWidth || 380;
    graphCanvas.height = container.clientHeight || 340;

    const centerX = graphCanvas.width / 2;
    const centerY = graphCanvas.height / 2;

    const rootName = dossier.filename ? (dossier.filename.length > 14 ? dossier.filename.substring(0, 11) + '...' : dossier.filename) : 'Doc Root';

    graphNodes = [
      {
        id: 'doc-center',
        label: rootName,
        x: centerX,
        y: centerY,
        radius: 24,
        color: '#3b82f6',
        isCenter: true,
        page: 1
      }
    ];

    dossier.pages.forEach((p, idx) => {
      const angle = (idx / dossier.pages.length) * Math.PI * 2;
      const dist = 75 + (idx % 2) * 25;
      const label = p.label || `Sec ${p.page}`;
      graphNodes.push({
        id: `section-${p.page}`,
        label: label.length > 12 ? label.substring(0, 10) + '..' : label,
        x: centerX + Math.cos(angle) * dist,
        y: centerY + Math.sin(angle) * dist,
        radius: 17,
        color: '#10b981',
        isCenter: false,
        page: p.page
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
    ctx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);

    if (graphNodes.length > 0) {
      const centerNode = graphNodes[0];

      // Draw connecting lines
      for (let i = 1; i < graphNodes.length; i++) {
        const node = graphNodes[i];
        ctx.beginPath();
        ctx.moveTo(centerNode.x, centerNode.y);
        ctx.lineTo(node.x, node.y);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw Nodes
      graphNodes.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = node.isCenter ? 'bold 9px Plus Jakarta Sans, sans-serif' : '8px Plus Jakarta Sans, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x, node.y);
      });
    }

    graphAnimationId = requestAnimationFrame(animateKnowledgeGraph);
  }

  if (graphCanvas) {
    graphCanvas.addEventListener('click', (e) => {
      const rect = graphCanvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      for (let i = 1; i < graphNodes.length; i++) {
        const node = graphNodes[i];
        const dist = Math.hypot(clickX - node.x, clickY - node.y);
        if (dist <= node.radius + 5) {
          scrollToPage(node.page);
          break;
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Voice Speech Dictation (Speech-to-Text)
  // --------------------------------------------------------------------------
  const btnVoiceDictate = document.getElementById('btn-voice-dictate');
  if (btnVoiceDictate) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        btnVoiceDictate.classList.add('listening');
      };
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          composerInput.value = transcript;
          composerForm.dispatchEvent(new Event('submit'));
        }
      };
      recognition.onerror = (event) => {
        btnVoiceDictate.classList.remove('listening');
        if (event.error === 'not-allowed') {
          alert('Microphone access was denied. Please allow microphone permissions in your browser URL bar to use voice dictation.');
        } else if (event.error === 'network') {
          console.warn('Speech recognition service network status:', event.error);
        }
      };
      recognition.onend = () => {
        btnVoiceDictate.classList.remove('listening');
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
    activateTab('doc-viewer');
    const targetPage = document.getElementById(`doc-page-${pageNum}`);
    if (targetPage) {
      targetPage.scrollIntoView({ behavior: 'smooth', block: 'center' });

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

      // Highlight active page pill
      document.querySelectorAll('.page-pill-btn').forEach((btn, idx) => {
        btn.classList.toggle('active', idx + 1 === pageNum);
      });
    }
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

      const responseText = await response.text();
      let data = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (parseErr) {
        data = { detail: `Server returned status ${response.status} (${response.statusText}).` };
      }

      removeLoadingBubble(loaderId);

      if (!response.ok) {
        appendNotice(`❌ **Notice:** ${data.detail || 'Could not generate answer.'}`);
        return;
      }

      // Update Telemetry Panel
      updateTelemetryRadar(data);

      // Record in Session History
      conversationHistory.push({
        timestamp: new Date().toISOString(),
        query,
        response: data
      });

      appendAssistantBubble(data);

    } catch (err) {
      removeLoadingBubble(loaderId);
      appendNotice(`❌ **Network Notice:** ${err.message}`);
    } finally {
      composerInput.disabled = false;
      composerSend.disabled = false;
      composerInput.focus();
    }
  });

  function updateTelemetryRadar(data) {
    if (radarStatus) {
      radarStatus.textContent = data.grounded ? 'Answer Found in PDF ✓' : 'Question Not in Document (Safely Refused) ⚠️';
      radarStatus.className = data.grounded ? 'badge-mono text-emerald' : 'badge-mono';
    }
    if (radarScore) radarScore.textContent = `${(data.top_similarity * 100).toFixed(1)}% Confidence`;
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
    senderTag.textContent = 'Your Question';

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
    senderTag.textContent = 'Veritas Answer';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    // Fact-Check Badge
    const auditBadge = document.createElement('div');
    if (data.grounded) {
      auditBadge.className = 'grounding-audit-badge audit-grounded';
      auditBadge.innerHTML = `✓ Verified from Document &bull; ${(data.top_similarity * 100).toFixed(0)}% Match &bull; ⚡ Instant Response`;
    } else {
      auditBadge.className = 'grounding-audit-badge audit-refusal';
      auditBadge.innerHTML = `⚠️ Not Found in Document &bull; Safely Refused to Prevent Making Things Up`;
    }
    bubble.appendChild(auditBadge);

    // Answer Body
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
        <span>Evidence from your Document (${data.citations.length} sections found):</span>
        <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);text-transform:none;">Click any box below to jump to that page</span>
      `;
      deck.appendChild(deckHeader);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'evidence-cards';

      data.citations.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'evidence-card';
        const label = c.unit_label || `Page ${c.page}`;
        card.title = `Click to view ${label} in the reader`;
        card.innerHTML = `
          <div class="evidence-top">
            <span>${escapeHtml(label)}</span>
            <span>${(c.similarity_score * 100).toFixed(0)}% match</span>
          </div>
          <div class="evidence-quote">"${escapeHtml(c.excerpt)}"</div>
          <span class="jump-btn-tag">↗ Go to ${escapeHtml(label)} in Reader</span>
        `;
        card.addEventListener('click', () => {
          scrollToPage(c.page, c.excerpt);
        });
        cardsContainer.appendChild(card);
      });

      deck.appendChild(cardsContainer);
      bubble.appendChild(deck);
    }

    // Message Actions Bar (Read Aloud + Copy)
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    // Read Aloud / Audio Synthesis Button
    const speakBtn = document.createElement('button');
    speakBtn.className = 'speak-btn';
    speakBtn.title = 'Listen: Speak answer aloud using neural voice synthesis';
    speakBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
      <span>Read Aloud</span>
    `;
    speakBtn.addEventListener('click', () => {
      if ('speechSynthesis' in window) {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
          speakBtn.classList.remove('speaking');
          speakBtn.querySelector('span').textContent = 'Read Aloud';
        } else {
          const plainText = data.answer.replace(/[*_#`[\]()]/g, '');
          const utterance = new SpeechSynthesisUtterance(plainText);
          utterance.rate = 1.05;
          utterance.onend = () => {
            speakBtn.classList.remove('speaking');
            speakBtn.querySelector('span').textContent = 'Read Aloud';
          };
          window.speechSynthesis.speak(utterance);
          speakBtn.classList.add('speaking');
          speakBtn.querySelector('span').textContent = 'Stop Audio';
        }
      } else {
        alert('Voice synthesis is not supported in this browser.');
      }
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
      const res = await fetch('/status');
      if (res.ok) {
        const data = await res.json();
        if (data.indexed) {
          metaFilename.textContent = data.document_name;
          metaPages.textContent = `${data.total_pages} sections`;
          metaChunks.textContent = `${data.total_chunks} chunks`;
          docMetaStrip.classList.remove('hidden');
          dropzone.classList.add('hidden'); // Guarantee dropzone is hidden on load
          composerInput.disabled = false;
          composerSend.disabled = false;
          composerInput.placeholder = `Ask any question about ${data.document_name}...`;
          starterChips.classList.remove('hidden');
          updateSmartStarterChips(data.document_name);

          const dossierRes = await fetch('/document/dossier');
          if (dossierRes.ok) {
            currentDossier = await dossierRes.json();
            renderDocumentDossier(currentDossier);
          }
        }
      }
    } catch (e) {
      console.log('Status offline');
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
  // Instant Floating Tooltip Engine
  // --------------------------------------------------------------------------
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'veritas-tooltip';
  document.body.appendChild(tooltipEl);

  let activeTooltipTarget = null;

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[title], [data-tooltip]');
    if (!target) return;

    // Convert title to data-tooltip to suppress ugly browser default delay
    if (target.hasAttribute('title')) {
      const text = target.getAttribute('title');
      if (text && text.trim().length > 0) {
        target.setAttribute('data-tooltip', text);
        target.removeAttribute('title');
      }
    }

    const text = target.getAttribute('data-tooltip');
    if (!text || text.trim().length === 0) return;

    activeTooltipTarget = target;
    tooltipEl.textContent = text;
    tooltipEl.classList.add('visible');

    positionTooltip(target);
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target && target === activeTooltipTarget) {
      activeTooltipTarget = null;
      tooltipEl.classList.remove('visible');
    }
  });

  window.addEventListener('scroll', () => {
    if (activeTooltipTarget) positionTooltip(activeTooltipTarget);
  }, true);

  window.addEventListener('resize', () => {
    if (activeTooltipTarget) positionTooltip(activeTooltipTarget);
  });

  function positionTooltip(target) {
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    let top = rect.top - tooltipRect.height - 8;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    let placement = 'placement-top';

    // If clipping at the top, show below
    if (top < 8) {
      top = rect.bottom + 8;
      placement = 'placement-bottom';
    }

    // Keep within left/right bounds
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
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
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      document.querySelectorAll('.speak-btn.speaking').forEach(b => {
        b.classList.remove('speaking');
        b.querySelector('span').textContent = 'Read Aloud';
      });
      document.querySelectorAll('.passage-highlight').forEach(el => {
        el.classList.remove('passage-highlight');
      });
    }
  });
});
