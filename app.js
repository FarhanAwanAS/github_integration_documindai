// API Configuration
// Default is 8000, but you can override via:
// - Query param: ?api=http://127.0.0.1:8001
// - LocalStorage: localStorage.setItem('DOCUMIND_API', 'http://127.0.0.1:8001')
const API_BASE_URL = (() => {
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get('api');
    const fromStorage = window.localStorage.getItem('DOCUMIND_API');
    return fromQuery || fromStorage || 'http://127.0.0.1:8002';
  } catch {
    return 'http://127.0.0.1:8002';
  }
})();

const TOKEN_KEY = 'DOCUMIND_TOKEN';

function getToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = Object.assign({}, options.headers || {});
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, Object.assign({}, options, { headers }));
}

// Global State
let currentStep = 1;
let uploadedFile = null;
let hasMessages = false;
let hasIndexedDocuments = false;
let currentSessionId = null;

// DOM Elements
const authContainer = document.getElementById('authContainer');
const appContainer = document.getElementById('appContainer');
const showLoginBtn = document.getElementById('showLoginBtn');
const showRegisterBtn = document.getElementById('showRegisterBtn');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authError = document.getElementById('authError');
const authSuccess = document.getElementById('authSuccess');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const regFullName = document.getElementById('regFullName');
const regUsername = document.getElementById('regUsername');
const regPassword = document.getElementById('regPassword');
const regDepartment = document.getElementById('regDepartment');
const regFiles = document.getElementById('regFiles');
const registerBtn = document.getElementById('registerBtn');
const logoutBtn = document.getElementById('logoutBtn');

const fileInput = document.getElementById('fileInput');
const fileText = document.getElementById('fileText');
const uploadBtn = document.getElementById('uploadBtn');
const queryInput = document.getElementById('queryInput');
const askBtn = document.getElementById('askBtn');
const messagesContainer = document.getElementById('messagesContainer');
const quickQuestionsDiv = document.getElementById('quickQuestionsDiv');
const sourceModal = document.getElementById('sourceModal');
const sourceModalBody = document.getElementById('sourceModalBody');
const sourceModalTitle = document.getElementById('sourceModalTitle');
const sourceModalClose = document.getElementById('sourceModalClose');
const sourceModalBackdrop = document.getElementById('sourceModalBackdrop');

function showAuth(message = '') {
  if (authContainer) authContainer.style.display = 'block';
  if (appContainer) appContainer.style.display = 'none';
  if (message) showError('authError', message);
}

function showApp() {
  if (authContainer) authContainer.style.display = 'none';
  if (appContainer) appContainer.style.display = 'block';
}

function setAuthMessage(kind, message) {
  if (kind === 'error') {
    if (authSuccess) { authSuccess.style.display = 'none'; authSuccess.textContent = ''; }
    if (authError) { authError.style.display = 'block'; authError.textContent = message; }
  } else {
    if (authError) { authError.style.display = 'none'; authError.textContent = ''; }
    if (authSuccess) { authSuccess.style.display = 'block'; authSuccess.textContent = message; }
  }
}

async function loadDepartments() {
  if (!regDepartment) return;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/departments`);
    const data = await res.json();
    const deps = Array.isArray(data.departments) ? data.departments : [];
    regDepartment.innerHTML = '';
    for (const d of deps) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      regDepartment.appendChild(opt);
    }
  } catch {
    // leave as-is
  }
}

async function doLogin() {
  const username = (loginUsername && loginUsername.value) ? loginUsername.value.trim() : '';
  const password = (loginPassword && loginPassword.value) ? loginPassword.value : '';
  if (!username || !password) {
    setAuthMessage('error', 'Enter username and password');
    return;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    setToken(data.token);
    setAuthMessage('success', 'Logged in');
    showApp();
    await detectExistingDocumentsAndStart();
  } catch (e) {
    setAuthMessage('error', e.message || 'Login failed');
  }
}

function doLogout() {
  clearToken();
  // Reset visible app state
  hasIndexedDocuments = false;
  hasMessages = false;
  currentSessionId = null;
  try {
    goToStep(1);
  } catch {
    // ignore
  }
  showAuth('Logged out');
}

async function doRegister() {
  const full_name = (regFullName && regFullName.value) ? regFullName.value.trim() : '';
  const username = (regUsername && regUsername.value) ? regUsername.value.trim() : '';
  const password = (regPassword && regPassword.value) ? regPassword.value : '';
  const department = (regDepartment && regDepartment.value) ? regDepartment.value : '';
  if (!full_name || !username || !password || !department) {
    setAuthMessage('error', 'All fields are required');
    return;
  }
  try {
    const fd = new FormData();
    fd.append('full_name', full_name);
    fd.append('username', username);
    fd.append('password', password);
    fd.append('department', department);
    const files = regFiles && regFiles.files ? Array.from(regFiles.files) : [];
    for (const f of files) fd.append('files', f);

    const res = await fetch(`${API_BASE_URL}/auth/register`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Registration failed');
    }
    setAuthMessage('success', 'Registered successfully. Please login.');
    // Switch to login
    if (registerForm) registerForm.style.display = 'none';
    if (loginForm) loginForm.style.display = 'block';
  } catch (e) {
    setAuthMessage('error', e.message || 'Registration failed');
  }
}

// File Input Handler
if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    uploadedFile = e.target.files[0];
    if (uploadedFile && fileText && uploadBtn) {
      fileText.textContent = uploadedFile.name;
      uploadBtn.disabled = false;
    }
  });
}

// Upload Button
if (uploadBtn) {
  uploadBtn.addEventListener('click', uploadDocument);
}

// Ask Button
if (askBtn) {
  askBtn.addEventListener('click', askQuestion);
}

// Source modal events
if (sourceModalClose) {
  sourceModalClose.addEventListener('click', closeSourceModal);
}
if (sourceModalBackdrop) {
  sourceModalBackdrop.addEventListener('click', closeSourceModal);
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sourceModal && sourceModal.classList.contains('active')) {
    closeSourceModal();
  }
});

// Progress step click navigation
document.querySelectorAll('.progress-step').forEach((stepEl) => {
  stepEl.addEventListener('click', () => {
    const targetStep = Number(stepEl.dataset.step);
    goToStep(targetStep, { fromTabClick: true });
  });
});

// Step Management
function goToStep(stepNum, options = {}) {
  const { fromTabClick = false } = options;

  // Process step is transitional and should not be opened via tab click.
  if (stepNum === 2 && fromTabClick) {
    if (hasIndexedDocuments) {
      stepNum = 3;
      showError('queryError', 'Process step is only available during upload.');
    } else {
      stepNum = 1;
      showError('uploadError', 'Please upload a document to start processing.');
    }
  }

  // Query requires at least one indexed document.
  if (stepNum === 3 && !hasIndexedDocuments) {
    if (fromTabClick) {
      showError('uploadError', 'No document found. Please upload a document first.');
    }
    stepNum = 1;
  }

  if (stepNum === 1) {
    resetUploadScreen();
  }

  // Always open Query as a fresh chat window when switching to Query tab/step.
  if (stepNum === 3) {
    resetQueryState();
  }

  // Hide all steps
  document.querySelectorAll('.step-container').forEach(el => {
    el.classList.remove('active');
  });

  // Show target step
  let targetStep = document.getElementById(`step-${stepNum}`);
  if (!targetStep) {
    stepNum = hasIndexedDocuments ? 3 : 1;
    targetStep = document.getElementById(`step-${stepNum}`);
  }
  targetStep.classList.add('active');

  // Update progress bar
  document.querySelectorAll('.progress-step').forEach(el => {
    const step = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (step === stepNum) {
      el.classList.add('active');
    } else if (step < stepNum) {
      el.classList.add('completed');
    }
  });

  const processStepTab = document.querySelector('.progress-step[data-step="2"]');
  if (processStepTab) {
    processStepTab.classList.toggle('disabled', stepNum !== 2);
  }

  currentStep = stepNum;
}

async function parseApiError(response) {
  try {
    const j = await response.json();
    if (typeof j.detail === 'string') return j.detail;
    if (Array.isArray(j.detail)) return j.detail.map((e) => e.msg || JSON.stringify(e)).join('; ');
    return JSON.stringify(j.detail);
  } catch {
    return response.statusText || 'Request failed';
  }
}

function finalizeIngestSuccess(data, displayName) {
  showSuccess('uploadSuccess', `✓ ${data.message}`);
  hasIndexedDocuments = true;
  document.getElementById('processingFilename').textContent = `📄 ${displayName}`;
  setTimeout(() => {
    if (data.status === 'duplicate' || data.processed === false) {
      goToStep(3);
    } else {
      goToStep(2);
      simulateProcessing();
    }
  }, 500);
}

// Upload Document
async function uploadDocument() {
  if (!uploadedFile) {
    showError('uploadError', 'Please select a file first');
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';
  clearMessages('uploadError', 'uploadSuccess');

  try {
    const formData = new FormData();
    formData.append('file', uploadedFile);

    const response = await authFetch(`${API_BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json();
    finalizeIngestSuccess(data, uploadedFile.name);
  } catch (error) {
    showError('uploadError', error.message || 'Failed to upload document');
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Continue';
  }
}

async function ingestFromUrl() {
  const input = document.getElementById('ingestUrlInput');
  const url = (input && input.value) ? input.value.trim() : '';
  if (!url) {
    showError('uploadError', 'Enter a URL');
    return;
  }
  const btn = document.getElementById('ingestUrlBtn');
  clearMessages('uploadError', 'uploadSuccess');
  btn.disabled = true;
  try {
    const response = await authFetch(`${API_BASE_URL}/ingest/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    const label = url.length > 60 ? url.slice(0, 60) + '…' : url;
    finalizeIngestSuccess(data, label);
  } catch (error) {
    showError('uploadError', error.message || 'URL ingest failed');
  } finally {
    btn.disabled = false;
  }
}

async function ingestFromText() {
  const ta = document.getElementById('ingestTextArea');
  const titleEl = document.getElementById('ingestTextTitle');
  const text = (ta && ta.value) ? ta.value.trim() : '';
  if (!text) {
    showError('uploadError', 'Paste some text to ingest');
    return;
  }
  const title = titleEl && titleEl.value.trim() ? titleEl.value.trim() : null;
  const btn = document.getElementById('ingestTextBtn');
  clearMessages('uploadError', 'uploadSuccess');
  btn.disabled = true;
  try {
    const response = await authFetch(`${API_BASE_URL}/ingest/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    const displayName = title || 'pasted_text.md';
    finalizeIngestSuccess(data, displayName);
  } catch (error) {
    showError('uploadError', error.message || 'Text ingest failed');
  } finally {
    btn.disabled = false;
  }
}

async function ingestFromGit() {
  const urlEl = document.getElementById('ingestGitUrl');
  const branchEl = document.getElementById('ingestGitBranch');
  const pathEl = document.getElementById('ingestGitPath');
  const repo_url = (urlEl && urlEl.value) ? urlEl.value.trim() : '';
  if (!repo_url) {
    showError('uploadError', 'Enter an https Git repository URL');
    return;
  }
  const branch = branchEl && branchEl.value.trim() ? branchEl.value.trim() : null;
  if (!branch) {
    showError('uploadError', 'Branch is required (e.g. main)');
    return;
  }
  const path_prefix = pathEl && pathEl.value.trim() ? pathEl.value.trim() : null;
  const btn = document.getElementById('ingestGitBtn');
  clearMessages('uploadError', 'uploadSuccess');
  btn.disabled = true;
  try {
    const response = await authFetch(`${API_BASE_URL}/ingest/git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url, branch, path_prefix }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    finalizeIngestSuccess(data, 'Git repository bundle');
  } catch (error) {
    showError('uploadError', error.message || 'Git ingest failed');
  } finally {
    btn.disabled = false;
  }
}

async function detectExistingDocumentsAndStart() {
  try {
    const response = await authFetch(`${API_BASE_URL}/documents`);
    if (!response.ok) throw new Error('Failed to fetch documents');
    const data = await response.json();
    hasIndexedDocuments = Array.isArray(data.documents) && data.documents.length > 0;
  } catch (error) {
    // If backend check fails, fall back to upload-first flow.
    hasIndexedDocuments = false;
  }

  if (hasIndexedDocuments) {
    goToStep(3);
  } else {
    goToStep(1);
  }
}

// Simulate Processing
function simulateProcessing() {
  let progress = 0;
  const steps = [
    { step: 'step-2-2', progress: 25 },
    { step: 'step-2-3', progress: 50 },
    { step: 'step-2-4', progress: 75 },
  ];

  const interval = setInterval(() => {
    progress += Math.random() * 25;
    if (progress > 100) progress = 100;

    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('progressText').textContent = Math.round(progress) + '%';

    // Activate steps gradually
    steps.forEach(({ step, progress: stepProgress }) => {
      if (progress >= stepProgress) {
        document.getElementById(step).classList.add('processing-step-active');
      }
    });

    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        goToStep(3);
      }, 1000);
    }
  }, 300);
}

// Ask Question
async function askQuestion() {
  const question = queryInput.value.trim();

  if (!question) return;

  // Hide quick questions on first question
  if (!hasMessages) {
    quickQuestionsDiv.style.display = 'none';
    hasMessages = true;
  }

  // Clear input
  queryInput.value = '';
  queryInput.disabled = true;
  askBtn.disabled = true;

  // Add user message
  addMessage('user', question);

  // Show typing indicator
  showTypingIndicator();

  try {
    const response = await authFetch(
      `${API_BASE_URL}/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Query failed');
    }

    const data = await response.json();

    // Remove typing indicator
    removeTypingIndicator();

    // Add assistant message
    addMessage('assistant', data.answer, data.sources);

    clearMessages('queryError');
  } catch (error) {
    removeTypingIndicator();
    showError('queryError', error.message || 'Failed to get answer');
  } finally {
    queryInput.disabled = false;
    askBtn.disabled = false;
    queryInput.focus();
  }
}

// Add Message to Chat
function addMessage(type, text, sources = []) {
  // Clear empty state
  if (messagesContainer.querySelector('.empty-state')) {
    messagesContainer.innerHTML = '';
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}-message`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  // Render markdown for assistant messages, plain text for user
  if (type === 'assistant') {
    contentDiv.innerHTML = marked.parse(text);
  } else {
    contentDiv.textContent = text;
  }
  
  messageDiv.appendChild(contentDiv);

  // Add sources if available
  if (sources && sources.length > 0) {
    const sourcesDiv = document.createElement('div');
    sourcesDiv.className = 'sources';

    const label = document.createElement('p');
    label.className = 'sources-label';
    label.textContent = '📌 Sources:';
    sourcesDiv.appendChild(label);

    sources.slice(0, 3).forEach((source, idx) => {
      const sourceObj = normalizeSource(source, idx);
      const sourceItem = document.createElement('div');
      sourceItem.className = 'source-item';

      const sourceLink = document.createElement('a');
      sourceLink.href = '#';
      sourceLink.className = 'source-link';
      sourceLink.textContent = sourceObj.text.substring(0, 150) + (sourceObj.text.length > 150 ? '...' : '');
      sourceLink.addEventListener('click', async (event) => {
        event.preventDefault();
        await openSourceModal(sourceObj);
      });

      sourceItem.appendChild(sourceLink);
      sourcesDiv.appendChild(sourceItem);
    });

    messageDiv.appendChild(sourcesDiv);
  }

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function normalizeSource(source, idx) {
  if (typeof source === 'string') {
    return {
      document_id: -1,
      filename: `Source ${idx + 1}`,
      chunk_index: -1,
      text: source,
    };
  }

  return {
    document_id: source.document_id ?? -1,
    filename: source.filename || `Source ${idx + 1}`,
    chunk_index: source.chunk_index ?? -1,
    text: source.text || '',
  };
}

async function openSourceModal(source) {
  sourceModal.classList.add('active');
  sourceModal.setAttribute('aria-hidden', 'false');
  sourceModalTitle.textContent = `Source: ${source.filename}`;
  sourceModalBody.innerHTML = '<p class="modal-loading">Loading source document...</p>';

  if (source.document_id < 0) {
    sourceModalBody.innerHTML = `<p class="modal-error">Unable to load full document for this source.</p><div class="modal-paragraph highlighted">${escapeHtml(source.text)}</div>`;
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/documents/${source.document_id}/content`);
    if (!response.ok) {
      throw new Error('Failed to load source document');
    }

    const data = await response.json();
    const chunks = data.chunks || [];

    if (!chunks.length) {
      sourceModalBody.innerHTML = '<p class="modal-error">No paragraphs found for this document.</p>';
      return;
    }

    const paragraphsHtml = chunks
      .map((chunk) => {
        const isTarget = Number(chunk.chunk_index) === Number(source.chunk_index);
        const className = isTarget ? 'modal-paragraph highlighted' : 'modal-paragraph';
        return `<div class="${className}" data-chunk-index="${chunk.chunk_index}">${escapeHtml(chunk.chunk_text)}</div>`;
      })
      .join('');

    sourceModalBody.innerHTML = paragraphsHtml;

    const highlighted = sourceModalBody.querySelector('.modal-paragraph.highlighted');
    if (highlighted) {
      highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (error) {
    sourceModalBody.innerHTML = `<p class="modal-error">${escapeHtml(error.message)}</p><div class="modal-paragraph highlighted">${escapeHtml(source.text)}</div>`;
  }
}

function closeSourceModal() {
  sourceModal.classList.remove('active');
  sourceModal.setAttribute('aria-hidden', 'true');
  sourceModalBody.innerHTML = '';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Show Typing Indicator
function showTypingIndicator() {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant-message';
  messageDiv.id = 'typing-indicator';

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';

  messageDiv.appendChild(indicator);
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Remove Typing Indicator
function removeTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

// Set Question
function setQuestion(q) {
  queryInput.value = q;
  queryInput.focus();
}

function startDocumentSession(documentId) {
  currentSessionId = `doc-${documentId}-${Date.now()}`;
  resetQueryState();
}

function resetUploadScreen() {
  uploadedFile = null;
  fileInput.value = '';
  fileText.textContent = 'Click or drag file here';
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Upload & Continue';
  clearMessages('uploadError', 'uploadSuccess');
}

function resetQueryState() {
  hasMessages = false;
  messagesContainer.innerHTML = `
    <div class="empty-state">
      <p class="empty-icon">🤔</p>
      <p class="empty-text">Start asking questions about your document</p>
    </div>
  `;
  quickQuestionsDiv.style.display = 'block';
  queryInput.value = '';
  clearMessages('queryError');
}

// Handle Query Enter Key
function handleQueryKeyPress(event) {
  if (event.key === 'Enter' && !queryInput.disabled) {
    askQuestion();
  }
}

// Utility Functions
function showError(elementId, message) {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.style.display = 'block';
}

function showSuccess(elementId, message) {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.style.display = 'block';
}

function clearMessages(...elementIds) {
  elementIds.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.style.display = 'none';
      element.textContent = '';
    }
  });
}

// Initialize
function bindIngestButtons() {
  const urlBtn = document.getElementById('ingestUrlBtn');
  const textBtn = document.getElementById('ingestTextBtn');
  const gitBtn = document.getElementById('ingestGitBtn');
  if (urlBtn) urlBtn.addEventListener('click', ingestFromUrl);
  if (textBtn) textBtn.addEventListener('click', ingestFromText);
  if (gitBtn) gitBtn.addEventListener('click', ingestFromGit);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bindIngestButtons();
    if (showLoginBtn && showRegisterBtn && loginForm && registerForm) {
      showLoginBtn.addEventListener('click', () => {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
      });
      showRegisterBtn.addEventListener('click', () => {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
      });
    }
    if (loginBtn) loginBtn.addEventListener('click', doLogin);
    if (registerBtn) registerBtn.addEventListener('click', doRegister);
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
    loadDepartments();

    if (!getToken()) {
      showAuth();
    } else {
      showApp();
      detectExistingDocumentsAndStart();
    }
  });
} else {
  bindIngestButtons();
  loadDepartments();
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
  if (!getToken()) {
    showAuth();
  } else {
    showApp();
    detectExistingDocumentsAndStart();
  }
}
