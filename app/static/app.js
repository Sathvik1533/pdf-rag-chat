/**
 * Frontend Application Controller for PDF RAG Assistant
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('pdf-file-input');
  const browseBtn = document.getElementById('browse-btn');
  const uploadSpinner = document.getElementById('upload-spinner');
  const uploadStatusMsg = document.getElementById('upload-status-msg');
  const docStatsCard = document.getElementById('doc-stats-card');
  const statFilename = document.getElementById('stat-filename');
  const statPages = document.getElementById('stat-pages');
  const statChunks = document.getElementById('stat-chunks');
  const statusBadge = document.getElementById('system-status-badge');
  const statusText = document.getElementById('status-text');

  const chatMessages = document.getElementById('chat-messages');
  const welcomeMessage = document.getElementById('welcome-message');
  const chatForm = document.getElementById('chat-form');
  const questionInput = document.getElementById('question-input');
  const sendBtn = document.getElementById('send-btn');
  const groundingHint = document.getElementById('grounding-info-hint');

  const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const groqApiKeyInput = document.getElementById('groq-api-key-input');
  const thresholdInput = document.getElementById('threshold-input');
  const thresholdVal = document.getElementById('threshold-val');

  let currentDocument = null;

  // Check server initial status
  checkStatus();

  // Settings Panel Toggle
  toggleSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  thresholdInput.addEventListener('input', (e) => {
    thresholdVal.textContent = parseFloat(e.target.value).toFixed(2);
    groundingHint.textContent = `Grounding floor: ${parseFloat(e.target.value).toFixed(2)}`;
  });

  // File Upload Handlers
  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.toLowerCase().endsWith('.pdf')) {
      handleUpload(files[0]);
    } else {
      alert('Please drop a valid PDF file.');
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleUpload(e.target.files[0]);
    }
  });

  // Auto-grow textarea & Enter handling
  questionInput.addEventListener('input', () => {
    questionInput.style.height = 'auto';
    questionInput.style.height = Math.min(questionInput.scrollHeight, 120) + 'px';
  });

  questionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled && questionInput.value.trim().length > 0) {
        chatForm.dispatchEvent(new Event('submit'));
      }
    }
  });

  // Upload Logic
  async function handleUpload(file) {
    const formData = new FormData();
    formData.append('file', file);

    // UI Loading State
    uploadSpinner.classList.remove('hidden');
    uploadStatusMsg.textContent = `Processing "${file.name}" (Extracting text & building FAISS index)...`;
    dropzone.classList.add('hidden');
    docStatsCard.classList.add('hidden');

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Upload failed');
      }

      // Success
      currentDocument = data;
      statFilename.textContent = data.filename;
      statPages.textContent = data.total_pages;
      statChunks.textContent = data.total_chunks;

      uploadSpinner.classList.add('hidden');
      docStatsCard.classList.remove('hidden');
      dropzone.classList.remove('hidden');

      statusBadge.className = 'status-badge status-ready';
      statusText.textContent = `Indexed: ${data.filename}`;

      // Enable Chat
      questionInput.disabled = false;
      sendBtn.disabled = false;
      questionInput.focus();

      if (welcomeMessage) {
        welcomeMessage.classList.add('hidden');
      }

      appendSystemMessage(`📄 **"${data.filename}"** is ready! ${data.total_pages} pages parsed into ${data.total_chunks} chunks. Ask any question below.`);

    } catch (err) {
      console.error(err);
      uploadSpinner.classList.add('hidden');
      dropzone.classList.remove('hidden');
      alert(`Upload error: ${err.message}`);
    }
  }

  // Chat Submission
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = questionInput.value.trim();
    if (!query) return;

    // Reset input
    questionInput.value = '';
    questionInput.style.height = 'auto';
    questionInput.disabled = true;
    sendBtn.disabled = true;

    // Append User Message
    appendMessage('user', query);

    // Append Loading Assistant Bubble
    const loadingId = 'loading-' + Date.now();
    appendLoadingBubble(loadingId);

    try {
      const payload = {
        question: query,
        groq_api_key: groqApiKeyInput.value.trim() || undefined,
        threshold: parseFloat(thresholdInput.value),
      };

      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      removeLoadingBubble(loadingId);

      if (!response.ok) {
        appendMessage('assistant', `❌ **Error:** ${data.detail || 'Failed to generate answer'}`);
        return;
      }

      appendAssistantResponse(data);

    } catch (err) {
      removeLoadingBubble(loadingId);
      appendMessage('assistant', `❌ **Network Error:** ${err.message}`);
    } finally {
      questionInput.disabled = false;
      sendBtn.disabled = false;
      questionInput.focus();
    }
  });

  // Render Functions
  function appendMessage(sender, text) {
    if (welcomeMessage) welcomeMessage.classList.add('hidden');

    const row = document.createElement('div');
    row.className = `message-row ${sender}`;

    const senderTag = document.createElement('div');
    senderTag.className = 'message-sender';
    senderTag.textContent = sender === 'user' ? 'You' : 'Assistant';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = window.marked ? marked.parse(text) : text;

    row.appendChild(senderTag);
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function appendSystemMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = window.marked ? marked.parse(text) : text;

    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function appendAssistantResponse(data) {
    if (welcomeMessage) welcomeMessage.classList.add('hidden');

    const row = document.createElement('div');
    row.className = 'message-row assistant';

    const senderTag = document.createElement('div');
    senderTag.className = 'message-sender';
    senderTag.textContent = 'Assistant';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // Grounding Status Pill
    const groundingBadge = document.createElement('div');
    if (data.grounded) {
      groundingBadge.className = 'grounding-badge grounded';
      groundingBadge.innerHTML = `✓ Grounded in Document (Confidence: ${(data.top_similarity * 100).toFixed(1)}%)`;
    } else {
      groundingBadge.className = 'grounding-badge refusal';
      groundingBadge.innerHTML = `⚠️ Low Confidence (${(data.top_similarity * 100).toFixed(1)}% &lt; ${(data.threshold * 100).toFixed(0)}%) — Grounding Refusal Enforced`;
    }
    bubble.appendChild(groundingBadge);

    // Answer Content
    const answerContent = document.createElement('div');
    answerContent.className = 'answer-markdown';
    answerContent.innerHTML = window.marked ? marked.parse(data.answer) : data.answer;
    bubble.appendChild(answerContent);

    // Citations (if grounded and present)
    if (data.grounded && data.citations && data.citations.length > 0) {
      const citationsBox = document.createElement('div');
      citationsBox.className = 'citations-box';

      const header = document.createElement('div');
      header.className = 'citations-header';
      header.textContent = `Evidence Citations (${data.citations.length} Chunks Used):`;
      citationsBox.appendChild(header);

      const list = document.createElement('div');
      list.className = 'citation-list';

      data.citations.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'citation-card';
        item.innerHTML = `
          <div class="citation-meta">
            <span>Page ${c.page}</span>
            <span>Similarity: ${(c.similarity_score * 100).toFixed(1)}%</span>
          </div>
          <div class="citation-excerpt">"${c.excerpt}"</div>
        `;
        list.appendChild(item);
      });

      citationsBox.appendChild(list);
      bubble.appendChild(citationsBox);
    }

    row.appendChild(senderTag);
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function appendLoadingBubble(id) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = id;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = '<div style="display:flex;align-items:center;gap:0.5rem;"><div class="spinner" style="width:14px;height:14px;"></div><span>Retrieving evidence & generating answer...</span></div>';

    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function removeLoadingBubble(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function checkStatus() {
    try {
      const res = await fetch('/status');
      if (res.ok) {
        const data = await res.json();
        if (data.indexed) {
          statFilename.textContent = data.document_name;
          statPages.textContent = data.total_pages;
          statChunks.textContent = data.total_chunks;
          docStatsCard.classList.remove('hidden');
          statusBadge.className = 'status-badge status-ready';
          statusText.textContent = `Indexed: ${data.document_name}`;
          questionInput.disabled = false;
          sendBtn.disabled = false;
        }
      }
    } catch (e) {
      console.log('Status check offline');
    }
  }
});
