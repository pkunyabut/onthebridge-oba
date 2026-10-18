// ─── Web UI Logic ────────────────────────────────────────────────────────────

let pollInterval = null;
let externalItems = [];
let transcriptItems = [];

// Text from the AI, from the web or from the user must be escaped before it goes into innerHTML
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtDate = value => (value ? new Date(value).toLocaleString() : '');

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();
});

function showTab(tab, button) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  if (button) button.classList.add('active');
  if (tab === 'jobs') loadJobs();
  if (tab === 'settings') loadInsights();
}

// ─── External Data ───────────────────────────────────────────────────────────

function addExternal() {
  const url = document.getElementById('ext-url').value.trim();
  const note = document.getElementById('ext-note').value.trim();
  if (!/^https?:\/\//i.test(url)) { alert('Please enter a URL that starts with http:// or https://'); return; }
  externalItems.push({ url, note });
  renderExternal();
  document.getElementById('ext-url').value = '';
  document.getElementById('ext-note').value = '';
}

function removeExternal(idx) {
  externalItems.splice(idx, 1);
  renderExternal();
}

function renderExternal() {
  const el = document.getElementById('external-list');
  el.innerHTML = externalItems.map((item, i) => `
    <div class="external-item">
      <div class="url">${esc(item.url)}</div>
      ${item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
      <button class="remove-btn" onclick="removeExternal(${i})">Remove</button>
    </div>
  `).join('');
}

// ─── Transcripts (interviews the owner pastes) ───────────────────────────────

function addTranscript() {
  const label = document.getElementById('tr-label').value.trim();
  const text = document.getElementById('tr-text').value.trim();
  if (text.length < 50) { alert('The transcript is too short (at least 50 characters)'); return; }
  if (transcriptItems.length >= 5) { alert('At most 5 interviews per article'); return; }
  transcriptItems.push({ label, text });
  renderTranscripts();
  document.getElementById('tr-label').value = '';
  document.getElementById('tr-text').value = '';
}

function removeTranscript(idx) {
  transcriptItems.splice(idx, 1);
  renderTranscripts();
}

function renderTranscripts() {
  const el = document.getElementById('transcript-list');
  el.innerHTML = transcriptItems.map((t, i) => `
    <div class="external-item">
      <div class="url">${esc(t.label || 'Interview ' + (i + 1))}</div>
      <div class="note">${t.text.length.toLocaleString()} characters — ${esc(t.text.slice(0, 80))}…</div>
      <button class="remove-btn" onclick="removeTranscript(${i})">Remove</button>
    </div>
  `).join('');
}

// ─── Model Dropdown ──────────────────────────────────────────────────────────

const modelsByProvider = {
  deepseek: [
    { value: 'deepseek-flash', label: 'DeepSeek Flash (default)' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o-mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' }
  ],
  anthropic: [
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (whole-job quality not yet tested)' },
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (very cheap; articles fell short of the standard in our tests)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (articles fell short of the standard in our tests)' },
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' }
  ],
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
  ],
  openrouter: [
    { value: 'auto', label: 'Auto (recommended)' },
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o-mini' },
    { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' }
  ]
};

function updateModelDropdown() {
  const provider = document.getElementById('ai-provider').value;
  const modelSelect = document.getElementById('model');
  const models = modelsByProvider[provider] || modelsByProvider.deepseek;
  modelSelect.innerHTML = models.map(m => `<option value="${esc(m.value)}">${esc(m.label)}</option>`).join('');
}

// ─── Create Job ──────────────────────────────────────────────────────────────

async function testConnection() {
  const provider = document.getElementById('ai-provider').value;
  const apiKey = document.getElementById('api-key').value.trim();
  const model = document.getElementById('model').value;

  const btn = document.getElementById('test-btn');
  const originalText = btn.textContent;
  btn.textContent = '⏳ Testing...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, apiKey })
    });
    const data = await res.json();

    if (data.success) {
      alert(`✅ Connected!\nProvider: ${provider}\nModel: ${model}\nTokens: ${data.usage?.totalTokens || 'N/A'}`);
    } else {
      alert(`❌ Connection failed\nProvider: ${provider}\nError: ${data.error}`);
    }
  } catch (e) {
    alert(`❌ Error: ${e.message}`);
  }

  btn.textContent = originalText;
  btn.disabled = false;
}

async function createJob() {
  const topic = document.getElementById('topic').value.trim();
  if (!topic) { alert('Please enter a topic'); return; }

  const provider = document.getElementById('ai-provider').value;
  const model = document.getElementById('model').value;
  // May be left empty — the server then uses the key from the project's .env file
  const apiKey = document.getElementById('api-key').value.trim();

  const btn = document.getElementById('create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  const body = {
    topic,
    provider,
    model,
    language: document.getElementById('language').value,
    audience: document.getElementById('audience').value,
    template: document.getElementById('template').value,
    pillar: document.getElementById('pillar').value,
    instructions: document.getElementById('instructions').value.trim(),
    deepseekKey: apiKey,
    searchKey: document.getElementById('search-key').value.trim(),
    external: externalItems,
    transcripts: transcriptItems
  };

  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.job) {
      showStatus('success', 'Job created! Job ID: ' + data.job.id);
      document.getElementById('topic').value = '';
      document.getElementById('instructions').value = '';
      externalItems = [];
      renderExternal();
      transcriptItems = [];
      renderTranscripts();
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => pollJob(data.job.id), 3000);
    } else {
      showStatus('error', data.error || 'Could not create the job');
    }
  } catch (e) {
    showStatus('error', 'Error: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Start the article';
}

function showStatus(type, msg) {
  const el = document.getElementById('create-status');
  const color = type === 'success' ? '#4aff8a' : '#ff4a4a';
  el.innerHTML = '<div class="card"><p style="color:' + color + '">' + esc(msg) + '</p></div>';
}

async function pollJob(jobId) {
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId));
    const data = await res.json();
    const done = ['ready_for_review', 'needs_revision', 'complete', 'error'];
    if (done.includes(data.job.status)) {
      clearInterval(pollInterval);
      if (data.job.status === 'ready_for_review' || data.job.status === 'complete') {
        showStatus('success', 'Job ' + jobId + ' passed the internal checks and is waiting for you to read and decide');
      } else if (data.job.status === 'needs_revision') {
        showStatus('error', 'Job ' + jobId + ' still has items to fix — open the job to see the list');
      } else {
        showStatus('error', 'The job failed: ' + (data.job.error || 'Unknown error'));
      }
      loadJobs();
    }
  } catch (e) { /* try again on the next tick */ }
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

async function loadJobs() {
  const el = document.getElementById('job-list');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const res = await fetch('/api/jobs');
    const data = await res.json();
    if (!data.jobs || data.jobs.length === 0) {
      el.innerHTML = '<div class="empty">No jobs yet</div>';
      return;
    }
    el.innerHTML = data.jobs.map(j => `
      <div class="job-item" onclick="viewJob('${esc(j.id)}')">
        <div>
          <div class="topic">${esc(j.topic)}</div>
          <div class="meta">${esc(j.id)} · ${esc(fmtDate(j.createdAt))}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="status status-${esc(j.status)}">${esc(j.status)}</span>
          <button class="remove-btn" onclick="event.stopPropagation(); deleteJob('${esc(j.id)}')" title="Delete">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  }
}

async function deleteJob(jobId) {
  if (!confirm('Delete job ' + jobId + '? Its folder and all its files will be removed.')) return;
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId), { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadJobs();
      document.getElementById('create-status').innerHTML = '';
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function viewJob(jobId) {
  try {
    // Make the Create tab (where the job view is drawn) visible
    showTab('create', document.querySelector('.tab'));
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId));
    const data = await res.json();
    const job = data.job;
    const stages = job.stages || {};

    let html = '<div class="card"><h2>📄 ' + esc(job.topic || 'Loading...') + '</h2>';
    const pl = stages.brief && stages.brief.result && stages.brief.result.pillar;
    if (pl) html += '<div style="margin:-4px 0 8px;font-size:12px;color:#aaa">Pillar: <b style="color:#8ab4ff">' + esc(pl) + '</b>' + (job.pillar && job.pillar !== 'auto' ? ' · chosen by the owner' : ' · chosen by the AI') + (job.language ? ' · language: ' + esc(job.language) : '') + '</div>';
    html += '<div class="stages">';
    const stageNames = ['brief', 'research', 'evidence', 'outline', 'write', 'review', 'channels', 'final'];
    stageNames.forEach(name => {
      const s = stages[name];
      const status = s ? s.status : 'pending';
      const icon = status === 'complete' ? '✓' : status === 'error' ? '✗' : status === 'processing' ? '⏳' : '○';
      html += '<div class="stage"><span class="icon stage-' + esc(status) + '">' + icon + '</span><span class="name">' + esc(name) + '</span></div>';
    });
    html += '</div>';
    if (job.error) html += '<p class="warn">⚠ ' + esc(job.error) + '</p>';
    html += '</div>';

    // Where the job's files are + a button to open the folder
    const jobDir = esc(job.dir || 'data/jobs/' + jobId);
    html += '<div class="card">';
    html += '<h3 style="font-size:13px;color:#4a9eff;margin-bottom:8px">📁 Job folder</h3>';
    html += '<p class="hint">Every file of this job (sources, drafts, checks, versions) is in this folder. You can open it with Claude Code or any editor.</p>';
    html += '<div style="background:#0f0f1a;padding:6px 8px;border-radius:4px;font-size:10px;color:#4a9eff;word-break:break-all;margin-bottom:8px">' + jobDir + '</div>';
    html += '<button class="btn btn-secondary btn-small" onclick="openFolder(\'' + esc(jobId) + '\')">📂 Open the folder</button>';
    html += '</div>';

    if (stages.channels && stages.channels.result) {
      const channels = stages.channels.result;
      const blockdit = channels.blockdit;
      const imagePrompts = channels.imagePrompts || {};

      html += '<div class="card">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">';
      html += '<div><h2 style="margin:0">' + esc(blockdit.title || job.topic) + '</h2>';
      if (blockdit.deck) html += '<p style="color:#888;font-size:13px;margin:4px 0 0">' + esc(blockdit.deck) + '</p>';
      html += '</div>';
      html += '<div style="display:flex;gap:6px">';
      html += '<button class="btn btn-secondary btn-small" onclick="copyArticle()">📋 Copy</button>';
      html += '<button class="btn btn-secondary btn-small" onclick="downloadArticle()">💾 Download .md</button>';
      html += '</div></div>';

      html += renderGate(stages.final && stages.final.result);

      // Human Gate: show the real review file — the hash sent with a decision is the hash of the content shown here
      const gate = await fetchDeliverable(jobId);
      html += renderDecisionPanel(job, gate);

      if (blockdit.wordCount) {
        html += '<div style="margin-bottom:12px;font-size:12px;color:#888">Word count: <strong style="color:#4aff8a">' + esc(blockdit.wordCount) + '</strong></div>';
      }

      html += '<div class="article-body">';
      html += renderBlockditBody(gate && gate.deliverable.content ? gate.deliverable.content : (blockdit.body || ''));
      html += '</div>';

      if (Object.keys(imagePrompts).length > 0) {
        html += '<div class="section-title">🖼️ Image prompts (for the illustrations)</div>';
        html += '<div class="image-prompts">';
        Object.entries(imagePrompts).forEach(([key, prompt]) => {
          if (prompt) {
            html += '<div class="prompt-item">';
            html += '<strong>' + esc(key) + ':</strong> <span>' + esc(prompt) + '</span>';
            html += ' <button class="btn btn-secondary btn-small" onclick="copyText(this.previousElementSibling.textContent)">Copy</button>';
            html += '</div>';
          }
        });
        html += '</div>';
      }

      html += '</div>';

      window._currentArticle = gate && gate.deliverable.content ? gate.deliverable.content : blockdit.body;
      window._currentArticleData = blockdit;
      window._currentJobId = jobId;
    }

    document.getElementById('create-status').innerHTML = html;

  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ─── Human Gate ──────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  ready_for_review: 'waiting for the owner to decide', needs_revision: 'has items to fix — waiting for the owner to decide',
  approved: 'approved', cancelled: 'cancelled', processing: 'working'
};
const DECISION_LABELS = { approve: '✅ Approve', revise: '✏️ Send back for edits', cancel: '✖ Cancel' };

async function fetchDeliverable(jobId) {
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/deliverable');
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

function renderDecisionPanel(job, gate) {
  if (!gate) return '';
  const d = gate.deliverable;
  const blockers = (job.stages.final && job.stages.final.result && job.stages.final.result.blockers) || [];
  let html = '<div class="gate-card decision-card">';
  html += '<strong>🧑‍⚖️ Human Gate — ' + esc(STATUS_LABELS[job.status] || job.status) + '</strong>';
  html += '<div class="hash">File ' + esc(d.file) + ' · version ' + esc(d.version) + ' · sha256 ' + esc((d.currentSha256 || '').slice(0, 16)) + '…</div>';

  if (!d.intact) {
    html += '<div class="warn">⚠ The file was edited or is missing since the system made it — this is not the version the system checked, so it cannot be approved</div>';
  }
  if (gate.approval && !gate.approval.valid) {
    html += '<div class="warn">⚠ The file was edited after approval — the earlier approval is no longer valid</div>';
  }

  if (d.intact && ['ready_for_review', 'needs_revision', 'approved'].includes(job.status)) {
    html += renderFactCheckPanel(job);
  }
  if (d.intact && job.status === 'approved') html += renderChannelsPanel(job);
  if (d.intact) html += renderWebCodePanel(job);
  if (d.intact) html += renderVersionsPanel(job);

  // An approved job can still be sent back or cancelled (but not approved again) — unless it was recorded as posted
  const canDecide = ['ready_for_review', 'needs_revision'].includes(job.status) || (job.status === 'approved' && !job.publishedAt);
  if (job.status === 'approved' && gate.approval && gate.approval.valid && !job.publishedAt) {
    html += '<p style="margin:8px 0 4px;color:#aaa">The system never publishes by itself — after you post the article yourself, you can record that here</p>';
    html += '<button class="btn btn-secondary btn-small" onclick="markPublished(\'' + esc(job.id) + '\')">📌 Record as posted</button>';
  }
  if (canDecide) {
    let decider = '';
    try { decider = localStorage.getItem('oba-decider') || ''; } catch (e) { /* storage blocked */ }
    html += '<p style="margin:8px 0 4px;color:#aaa">Read the whole article below before you decide — an approval is tied to this exact file</p>';
    html += '<input id="gate-decider" placeholder="Your name (the person deciding)" value="' + esc(decider) + '">';
    html += '<textarea id="gate-note" rows="3" placeholder="Instruction / note (required when sending back, e.g. cut the paragraph about the stock)"></textarea>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    if (d.intact && job.status !== 'approved') {
      html += '<button class="btn btn-primary btn-small" onclick="decideJob(\'' + esc(job.id) + '\',\'approve\',\'' + esc(d.currentSha256) + '\',' + blockers.length + ')">' + DECISION_LABELS.approve + '</button>';
    }
    if (d.intact) {
      html += '<button class="btn btn-secondary btn-small" onclick="decideJob(\'' + esc(job.id) + '\',\'revise\',\'' + esc(d.currentSha256) + '\',0)">' + DECISION_LABELS.revise + '</button>';
    }
    html += '<button class="btn btn-secondary btn-small" onclick="decideJob(\'' + esc(job.id) + '\',\'cancel\',\'' + esc(d.currentSha256 || '') + '\',0)">' + DECISION_LABELS.cancel + '</button>';
    html += '</div>';
  } else if (job.publishedAt) {
    html += '<p style="margin:8px 0 0;color:#4aff8a">📌 Recorded as posted on ' + esc(fmtDate(job.publishedAt)) + '</p>';
  }

  if (gate.decisions && gate.decisions.length) {
    html += '<div class="history"><b>Decision history</b><ul>' + gate.decisions.map(x =>
      '<li>' + esc(DECISION_LABELS[x.decision] || x.decision) + ' · ' + esc(x.decidedBy) + ' · ' +
      esc(fmtDate(x.decidedAt)) + ' · version ' + esc(x.version) + ' · sha256 ' + esc(String(x.sha256 || '').slice(0, 12)) + '…' +
      (x.note ? '<br><span class="sentence">“' + esc(x.note) + '”</span>' : '') + '</li>'
    ).join('') + '</ul></div>';
  }
  return html + '</div>';
}

async function decideJob(jobId, decision, sha256, blockerCount) {
  const decidedBy = (document.getElementById('gate-decider').value || '').trim();
  const note = (document.getElementById('gate-note').value || '').trim();
  if (!decidedBy) { alert('Please enter the name of the person deciding'); return; }
  if (decision === 'revise' && !note) { alert('Sending back for edits needs a note saying what to change'); return; }

  let acknowledgeBlockers = false;
  if (decision === 'approve' && blockerCount > 0) {
    if (!confirm('The system found ' + blockerCount + ' item(s) that still need fixing in this job.\nConfirm that you have read them and approve anyway?')) return;
    acknowledgeBlockers = true;
  }
  const confirmText = { approve: 'Approve this version of the file?', revise: 'Send it back for the system to fix as instructed?', cancel: 'Cancel this job?' }[decision];
  if (!acknowledgeBlockers && !confirm(confirmText)) return;

  try { localStorage.setItem('oba-decider', decidedBy); } catch (e) { /* storage blocked */ }
  const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, decidedBy, note, sha256, acknowledgeBlockers })
  });
  const data = await res.json();
  if (!res.ok) { alert('Could not record the decision: ' + data.error); return; }
  if (decision === 'revise') {
    showStatus('success', 'Sent back — the system is fixing it and will check again');
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => pollJob(jobId), 3000);
  } else {
    viewJob(jobId);
  }
  loadJobs();
}

async function markPublished(jobId) {
  if (!confirm('Record that you posted this article yourself?')) return;
  const post = ack => fetch('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, factCheckAcknowledged: ack })
  });
  let res = await post(false);
  let data = await res.json();
  if (res.status === 409 && data.needsAck) {
    // Items remain that the system did not find in the sources — a person must confirm they opened and checked them
    if (!confirm('⚠ ' + data.error + '\n\nHave you checked those items yourself, and do you want to record it as posted?')) return;
    res = await post(true);
    data = await res.json();
  }
  if (!res.ok) { alert('Could not record: ' + data.error); return; }
  viewJob(jobId);
}

// ─── Fact check before posting (code only, no AI call) ───────────────────────

const FACT_KIND_LABELS = { number: 'number', name: 'name', quote: 'quote', citation: 'reference number' };
const FACT_RISK_LABELS = { number: 'number', name: 'name', quote: 'quote', allegation: 'allegation / legal', uncited: 'no reference number' };

async function runFactCheck(jobId, usePasted, deep) {
  const out = document.getElementById('factcheck-out-' + jobId);
  if (!out) return;
  out.innerHTML = '<span style="color:#aaa">' + (deep ? 'Running the deep check (searching for a second source and opening pages — may take 1–2 minutes)…' : 'Checking…') + '</span>';
  const pasted = usePasted ? (document.getElementById('factcheck-text-' + jobId) || {}).value || '' : '';
  if (usePasted && !pasted.trim()) { out.innerHTML = '<span class="warn">No text pasted yet</span>'; return; }
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/factcheck' + (deep ? '?deep=1' : ''), usePasted
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: pasted }) }
      : undefined);
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<span class="warn">' + esc(data.error || 'Could not check') + '</span>'; return; }
    out.innerHTML = renderFactReport(data);
  } catch (e) {
    out.innerHTML = '<span class="warn">Could not check: ' + esc(e.message) + '</span>';
  }
}

function renderFactReport(r) {
  let html = '<div style="font-size:12px;color:#aaa;margin:6px 0">Checked ' + (r.edited ? 'the pasted text' : 'the review file') + ' · compared with the cited sources in code, with no AI · file ' + esc(r.file) + ' in the job folder</div>';
  if (r.flags.length) {
    html += '<div class="warn"><b>⚠ ' + r.flags.length + ' item(s) to check yourself</b></div><ul>' + r.flags.map(f =>
      '<li><b>' + esc(FACT_KIND_LABELS[f.kind] || f.kind) + '</b> "' + esc(f.token) + '" — ' + esc(f.reason) +
      '<div style="color:#aaa">' + esc(f.sentence) + (f.cited.length ? ' [' + f.cited.map(esc).join('][') + ']' : '') + '</div></li>').join('') + '</ul>';
  } else {
    html += '<div style="color:#4aff8a">✓ Every number / name / quote was found in the cited sources (this does not certify that the sources are correct)</div>';
  }
  const risky = (r.rows || []).filter(x => x.risks.length).slice(0, 12);
  if (risky.length) {
    html += '<div style="margin-top:8px"><b>High-risk items (compare with the source first)</b></div><ul>' + risky.map(x =>
      '<li>' + (x.flagged ? '⚠ ' : '') + '<span style="color:#ffc857">[' + x.risks.map(k => esc(FACT_RISK_LABELS[k] || k)).join(', ') + (x.singleSource ? ', single source' : '') + (x.primary ? ', has a primary source' : '') + ']</span> ' +
      esc(x.sentence) + (x.cited.length ? ' [' + x.cited.map(esc).join('][') + ']' : '') +
      (x.evidence ? '<div style="color:#aaa">Confirming quote: ' + esc(x.evidence) + '</div>' : '') +
      (x.secondSource ? '<div style="color:' + (x.secondSource.status === 'confirmed' ? '#4aff8a' : '#ffc857') + '">Second source: ' + esc(secondSourceLabel(x.secondSource)) + (x.secondSource.url ? ' — <a href="' + esc(x.secondSource.url) + '" target="_blank" rel="noopener noreferrer">open</a>' : '') + '</div>' : '') +
      (x.factChecks || []).map(f => '<div style="color:#ffc857">Fact Check Tools: ' + esc(f.publisher) + ' rated it "' + esc(f.rating) + '" — <a href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer">' + esc(f.title || f.claim) + '</a></div>').join('') + '</li>').join('') + '</ul>';
  }
  if (r.notes && r.notes.length) html += '<div style="color:#aaa;margin-top:6px">' + r.notes.map(esc).join('<br>') + '</div>';
  html += '<div style="margin-top:8px"><b>Sources</b></div><ul>' + (r.sources || []).map(s =>
    '<li>[' + esc(s.n) + '] ' + esc(s.title || '') + (s.url ? ' — <a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">open the source</a>' : ' — interview supplied by the team') + (s.primary_source ? ' · primary source' : '') + '</li>').join('') + '</ul>';
  return html;
}

function secondSourceLabel(s) {
  if (s.status === 'confirmed') return 'confirmed by a second source';
  if (s.status === 'not_found') return 'still a single source (no independent page found that confirms it — this does not mean it is wrong)';
  if (s.status === 'skipped') return 'skipped — ' + (s.reason || '');
  return 'check failed — ' + (s.reason || '');
}

const RECHECK_LABELS = { same: '✓ unchanged', changed: '⚠ content changed a lot', quote_missing: '⚠ confirming quote gone', unreachable: '✗ cannot be opened', skipped: '– skipped' };

async function runRecheck(jobId) {
  const out = document.getElementById('factcheck-out-' + jobId);
  if (!out) return;
  out.innerHTML = '<span style="color:#aaa">Opening the sources one by one…</span>';
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/recheck', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<span class="warn">' + esc(data.error || 'Could not check') + '</span>'; return; }
    const bad = data.results.filter(r => ['changed', 'quote_missing', 'unreachable'].includes(r.status)).length;
    out.innerHTML = '<div style="margin:6px 0"><b>Sources re-checked at ' + esc(fmtDate(data.checkedAt)) + '</b> — ' +
      (bad ? '<span class="warn">' + bad + ' source(s) deserve another look</span>' : '<span style="color:#4aff8a">no worrying change found</span>') + '</div><ul>' +
      data.results.map(r => '<li>[' + esc(r.n) + '] ' + esc(r.title || '') + ' — ' + esc(RECHECK_LABELS[r.status] || r.status) + ' · ' + esc(r.detail || '') +
        (r.url ? ' — <a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">open</a>' : '') + '</li>').join('') + '</ul>';
  } catch (e) {
    out.innerHTML = '<span class="warn">Could not check: ' + esc(e.message) + '</span>';
  }
}

// ─── Copies of every review version + what changed ───────────────────────────

const DECISION_SHORT = { approve: 'approved', revise: 'sent back', cancel: 'cancelled' };

async function loadVersions(jobId) {
  const out = document.getElementById('versions-out-' + jobId);
  if (!out) return;
  out.innerHTML = '<span style="color:#aaa">Loading…</span>';
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/versions');
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<span class="warn">' + esc(data.error || 'Could not load') + '</span>'; return; }
    if (!data.versions.length) { out.innerHTML = '<span style="color:#aaa">No copies yet</span>'; return; }
    out.innerHTML = '<ul>' + data.versions.map(v => {
      const isCurrent = v.version === data.current;
      const decisions = (v.decisions || []).map(d => esc(DECISION_SHORT[d.decision] || d.decision) + (d.note ? ' ("' + esc(d.note.slice(0, 60)) + '")' : '')).join(', ');
      return '<li><b>Version ' + esc(v.version) + '</b>' + (isCurrent ? ' (current)' : '') +
        ' · ' + esc(fmtDate(v.createdAt)) +
        (v.wordCount ? ' · ' + esc(v.wordCount) + ' words' : '') +
        (decisions ? ' · <span style="color:#ffc857">' + decisions + '</span>' : '') +
        (isCurrent ? '' : ' <button class="btn btn-secondary btn-small" onclick="showDiff(\'' + esc(jobId) + '\',' + esc(v.version) + ')">Compare with the current version</button>') + '</li>';
    }).join('') + '</ul><div id="diff-out-' + esc(jobId) + '"></div>';
  } catch (e) {
    out.innerHTML = '<span class="warn">Could not load: ' + esc(e.message) + '</span>';
  }
}

async function showDiff(jobId, from) {
  const out = document.getElementById('diff-out-' + jobId);
  if (!out) return;
  out.innerHTML = '<span style="color:#aaa">Comparing…</span>';
  const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/versions?from=' + from + '&to=current');
  const data = await res.json();
  if (!res.ok) { out.innerHTML = '<span class="warn">' + esc(data.error || 'Could not compare') + '</span>'; return; }
  const changed = data.ops.filter(o => o.type !== 'same');
  let html = '<div style="margin:6px 0"><b>Version ' + esc(data.from) + ' → version ' + esc(data.to) + '</b> · removed ' + data.summary.removed + ' paragraph(s) · added ' + data.summary.added + ' · unchanged ' + data.summary.same + '</div>';
  if (!changed.length) html += '<div style="color:#aaa">Every paragraph is the same</div>';
  html += changed.map(o => o.type === 'del'
    ? '<div style="background:#3a1a1a;border-left:3px solid #ff6b6b;padding:6px 8px;margin:4px 0;font-size:12px"><b>− removed / changed from</b><br>' + esc(o.text) + '</div>'
    : '<div style="background:#16301f;border-left:3px solid #4aff8a;padding:6px 8px;margin:4px 0;font-size:12px"><b>+ added / changed to</b><br>' + esc(o.text) + '</div>').join('');
  out.innerHTML = html;
}

// ─── Drafts for other channels (Facebook, X, LinkedIn, newsletter, video script, plain HTML) ─────

const CHANNEL_LABELS = { social: 'Facebook / X / LinkedIn captions', newsletter: 'Newsletter summary', 'video-script': 'Short-video script', 'website-html': 'Plain HTML page' };

function renderChannelsPanel(job) {
  const id = esc(job.id);
  return '<div style="margin-top:10px;border-top:1px solid #2a2a3e;padding-top:8px"><b>📣 Drafts for other channels</b>' +
    '<p style="margin:4px 0;color:#aaa;font-size:12px">Made from this approved version only, in the job\'s language, by the same AI model, and told to add no new facts. The system never posts for you — copy a draft, read it, and post it yourself. Only the Blockdit channel has been tested end to end; the others are untested drafts.</p>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
    Object.entries(CHANNEL_LABELS).map(([f, label]) => '<button class="btn btn-secondary btn-small" onclick="makeDrafts(\'' + id + '\',\'' + f + '\')">' + esc(label) + '</button>').join('') +
    '</div><div id="channels-out-' + id + '"></div></div>';
}

async function makeDrafts(jobId, format) {
  const out = document.getElementById('channels-out-' + jobId);
  if (!out) return;
  out.innerHTML = '<span style="color:#aaa">Writing the draft…</span>';
  try {
    const apiKey = (document.getElementById('api-key') || {}).value || '';
    const res = await fetch('/api/export-formats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, formats: [format], deepseekKey: apiKey.trim() })
    });
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<span class="warn">' + esc(data.error || 'Could not make the draft') + '</span>'; return; }
    const draft = data.results[format];
    if (!draft || draft.error) { out.innerHTML = '<span class="warn">' + esc((draft && draft.error) || 'No draft was returned') + '</span>'; return; }
    out.innerHTML = '<label>' + esc(CHANNEL_LABELS[format] || format) + ' (also saved under data/exports)</label>' +
      '<textarea id="draft-text-' + esc(jobId) + '" rows="12" style="width:100%;font-size:12px">' + esc(draft) + '</textarea>' +
      '<button class="btn btn-secondary btn-small" onclick="copyText(document.getElementById(\'draft-text-' + esc(jobId) + '\').value)">Copy</button>';
  } catch (e) {
    out.innerHTML = '<span class="warn">Could not make the draft: ' + esc(e.message) + '</span>';
  }
}

async function loadWebCode(jobId) {
  const out = document.getElementById('webcode-out-' + jobId);
  if (!out) return;
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/webcode');
    const d = await res.json();
    if (!res.ok) { out.innerHTML = '<span class="warn">' + esc(d.error || 'Could not load') + '</span>'; return; }
    const sg = d.suggestion || {};
    const cur = (d.chosen && d.chosen.code) || sg.code || '';
    const opts = Object.keys(d.codes).map(c => '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + ' — ' + esc(d.codes[c]) + '</option>').join('');
    out.innerHTML = '<div style="font-size:12px;color:#aaa;margin:4px 0">Pillar: <b>' + esc(d.pillar || '(none yet)') + '</b> · suggested code: <b>' + esc(sg.code || 'none — choose one') + '</b>' +
      (sg.needsChoice ? ' <span style="color:#ffc857">(Life Skills is chosen by hand each time: ' + esc((sg.choices || []).join(' / ')) + ')</span>' : '') +
      (sg.note ? '<br>' + esc(sg.note) : '') + (d.chosen ? '<br>Already chosen: <b style="color:#4aff8a">' + esc(d.chosen.code) + '</b>' : '') + '</div>' +
      '<select id="webcode-select-' + esc(jobId) + '"><option value="">— choose a website category code —</option>' + opts + '</select> ' +
      '<button class="btn btn-secondary btn-small" onclick="saveWebCode(\'' + esc(jobId) + '\')">Save the code</button>';
    if (!cur) document.getElementById('webcode-select-' + jobId).value = '';
  } catch (e) { out.innerHTML = '<span class="warn">Could not load: ' + esc(e.message) + '</span>'; }
}

async function saveWebCode(jobId) {
  const code = document.getElementById('webcode-select-' + jobId).value;
  if (!code) { alert('Choose a category code first'); return; }
  const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/webcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const d = await res.json();
  if (!res.ok) { alert('Could not save: ' + d.error); return; }
  loadWebCode(jobId);
}

function renderWebCodePanel(job) {
  const id = esc(job.id);
  return '<div style="margin-top:10px;border-top:1px solid #2a2a3e;padding-top:8px"><b>🏷 Website category code</b> <button class="btn btn-secondary btn-small" onclick="loadWebCode(\'' + id + '\')">View / choose</button>' +
    '<p style="margin:4px 0;color:#aaa;font-size:12px">The code is a suggestion from the Pillar (an example mapping — edit src/webCategory.mjs for your site). You can change it before publishing; the Pillar is always stored with the code.</p><div id="webcode-out-' + id + '"></div></div>';
}

function renderVersionsPanel(job) {
  const id = esc(job.id);
  return '<div style="margin-top:10px;border-top:1px solid #2a2a3e;padding-top:8px">' +
    '<b>🗂 Every version</b> <button class="btn btn-secondary btn-small" onclick="loadVersions(\'' + id + '\')">List / compare what changed</button>' +
    '<p style="margin:4px 0;color:#aaa;font-size:12px">The system keeps a copy of every version sent for review in the job\'s versions folder — never overwritten, never deleted</p>' +
    '<div id="versions-out-' + id + '"></div></div>';
}

function renderFactCheckPanel(job) {
  const id = esc(job.id);
  return '<div style="margin-top:10px;border-top:1px solid #2a2a3e;padding-top:8px">' +
    '<b>🔎 Fact check before posting</b>' +
    '<p style="margin:4px 0;color:#aaa;font-size:12px">Compares the numbers, names and quotes in the article with the sources it cites — if you edit the text after approval, paste the version you will really post to check it</p>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
    '<button class="btn btn-secondary btn-small" onclick="runFactCheck(\'' + id + '\',false)">Check the approved version</button>' +
    '<button class="btn btn-secondary btn-small" onclick="runFactCheck(\'' + id + '\',true)">Check the pasted text</button>' +
    '<button class="btn btn-secondary btn-small" onclick="runFactCheck(\'' + id + '\',false,true)" title="Search for a second independent source + Google Fact Check Tools (a small search cost)">Deep check</button>' +
    (job.status === 'approved' ? '<button class="btn btn-secondary btn-small" onclick="runRecheck(\'' + id + '\')" title="Open the source links again and compare with the copy made at writing time">Re-check the sources</button>' : '') + '</div>' +
    '<textarea id="factcheck-text-' + id + '" rows="3" placeholder="Paste the version you will really post (optional) — it must keep the reference numbers [1] [2] as in the review file"></textarea>' +
    '<div id="factcheck-out-' + id + '"></div></div>';
}

// Result of the last gate: passed the internal checks, or items still to fix (with the sentence and the fix)
function renderGate(final) {
  if (!final || !final.verdict || final.verdict === 'pass') return '';
  const ok = final.verdict === 'ready_for_human_review';
  let html = '<div class="gate-card ' + (ok ? 'ok' : 'block') + '">';
  html += '<strong>' + (ok ? '✓ Passed the internal checks — waiting for the owner to read and decide' : '⚠ ' + (final.blockers || []).length + ' item(s) still to fix (after ' + esc(final.revisions) + ' internal revision round(s))') + '</strong>';
  if (!ok && final.blockers && final.blockers.length) {
    html += '<ul>' + final.blockers.map(b =>
      '<li><b>' + esc(b.kind) + '</b>' + (b.section ? ' [' + esc(b.section) + ']' : '') + ': ' + esc(b.problem) +
      (b.sentence ? '<br><span class="sentence">“' + esc(b.sentence) + '”</span>' : '') +
      (b.fix ? '<br>Fix: ' + esc(b.fix) : '') + '</li>'
    ).join('') + '</ul>';
  }
  if (final.notes && final.notes.length) {
    html += '<ul>' + final.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>';
  }
  const eb = final.evidenceBase;
  if (eb) {
    html += '<div style="margin-top:6px;font-size:12px;color:#aaa"><b style="color:' + (eb.level === 'thin' ? '#ffc857' : '#4aff8a') + '">Evidence base: ' + (eb.level === 'thin' ? 'thin' : 'enough') + '</b> · ' +
      esc(eb.uniqueClaims) + ' non-duplicate fact(s)' + (eb.duplicateClaims ? ' (' + esc(eb.duplicateClaims) + ' duplicate)' : '') + ' · ' +
      eb.organizations.map(o => esc(o.name) + ' ' + esc(o.claims) + ' fact(s)/' + esc(o.pages) + ' page(s)').join(' · ') +
      (eb.primaryPages ? ' · primary sources: ' + esc(eb.primaryPages) + ' page(s)' : '') + '</div>';
  }
  if (final.advisories && final.advisories.length) {
    html += '<details open style="margin-top:6px"><summary>Style / repetition observations (they do not block the job)</summary><ul>' + final.advisories.map(a =>
      '<li><b>' + esc(a.kind) + '</b>' + (a.section ? ' [' + esc(a.section) + ']' : '') + ': ' + esc(a.problem) +
      (a.sentence ? '<br><span class="sentence">“' + esc(a.sentence) + '”</span>' : '') + '</li>'
    ).join('') + '</ul></details>';
  }
  if (ok && final.disclaimer) html += '<div style="color:#888;margin-top:6px">' + esc(final.disclaimer) + '</div>';
  return html + '</div>';
}

function renderBlockditBody(body) {
  // Escaped before the Markdown is converted, so no HTML from the content can get into the page
  return esc(body)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => /^(https?:|images\/)/i.test(src)
      ? '<img src="' + src + '" alt="' + alt + '" style="max-width:100%;border-radius:8px;margin:16px 0;display:block">'
      : m)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^## ([^\n]+)/gm, '<h3 style="color:#fff;margin:20px 0 8px;font-size:15px">$1</h3>')
    .replace(/^# ([^\n]+)/gm, '<h2 style="color:#fff;margin:4px 0 8px">$1</h2>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #2a2a3e;margin:20px 0">')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

function copyArticle() {
  if (window._currentArticle) {
    navigator.clipboard.writeText(window._currentArticle).then(() => alert('Article copied!'));
  }
}

function downloadArticle() {
  if (window._currentArticle) {
    const blob = new Blob([window._currentArticle], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = String(window._currentArticleData?.title || window._currentJobId || 'article').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.md';
    a.click();
    URL.revokeObjectURL(url);
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => alert('Copied!'));
}

async function openFolder(jobId) {
  try {
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    });
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ─── Insights: production numbers and recurring review issues ────────────────

async function loadInsights() {
  await Promise.all([loadAnalytics(), loadCosts(), loadSkills()]);
}

async function loadCosts() {
  const el = document.getElementById('costs-view');
  try {
    const res = await fetch('/api/costs');
    const c = await res.json();
    const money = n => esc((Number(n) || 0).toFixed(2)) + ' ' + esc(c.currency || 'USD');
    const rows = Object.entries(c.byProvider || {}).map(([p, v]) => `<div class="pattern"><span>${esc(p)}</span><strong>${money(v)}</strong></div>`).join('') || '<div class="empty">None yet</div>';
    el.innerHTML = `
      <div class="grid2">
        <div><div class="pattern"><span>This month</span><strong>${money(c.thisMonth)}</strong></div>
             <div class="pattern"><span>Last month</span><strong>${money(c.lastMonth)}</strong></div>
             <div class="pattern"><span>All time</span><strong>${money(c.allTime)}</strong></div>
             <div class="pattern"><span>Average per job</span><strong>${money(c.averagePerJob)}</strong></div></div>
        <div><h3 style="font-size:12px;color:#888;margin-bottom:8px">By provider</h3>${rows}</div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  }
}

async function loadAnalytics() {
  const el = document.getElementById('analytics-view');
  try {
    const res = await fetch('/api/analytics');
    const data = await res.json();
    const a = data.analytics || {};
    const box = (value, label, color) => `
      <div style="padding:12px;background:#0f0f1a;border-radius:6px;text-align:center">
        <div style="font-size:24px;color:${color};font-weight:bold">${esc(value)}</div>
        <div style="font-size:11px;color:#888">${esc(label)}</div>
      </div>`;
    const rows = entries => entries.map(([k, v]) => `<div class="pattern"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('') || '<div class="empty">None yet</div>';
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px">
        ${box(a.totalArticles || 0, 'articles', '#4aff8a')}
        ${box(a.publishedArticles || 0, 'recorded as posted', '#4a9eff')}
        ${box((a.totalWordCount || 0).toLocaleString(), 'words in total', '#ffaa4a')}
        ${box(a.averageWordCount || 0, 'average words', '#fff')}
      </div>
      <div class="grid2">
        <div><h3 style="font-size:12px;color:#888;margin-bottom:8px">By month</h3>${rows(Object.entries(a.articlesByMonth || {}))}</div>
        <div><h3 style="font-size:12px;color:#888;margin-bottom:8px">By template</h3>${rows(Object.entries(a.articlesByTemplate || {}))}</div>
      </div>
      <div style="margin-top:12px"><h3 style="font-size:12px;color:#888;margin-bottom:8px">Top source domains</h3>${rows(Object.entries(a.sourcesByDomain || {}).sort((x, y) => y[1] - x[1]).slice(0, 5))}</div>`;
  } catch (e) {
    el.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  }
}

async function loadSkills() {
  const el = document.getElementById('skills-view');
  try {
    const res = await fetch('/api/skills');
    const data = await res.json();
    const issues = (data.quality && data.quality.commonIssues) || [];
    el.innerHTML = issues.length === 0
      ? '<div class="empty">Nothing recurring yet</div>'
      : issues.map(i => '<div class="pattern"><span>' + esc(i.issue) + '</span><span>' + esc(i.count) + '×</span></div>').join('');
  } catch (e) {
    el.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  }
}

async function exportCSV() {
  try {
    const res = await fetch('/api/export');
    const data = await res.json();
    const url = URL.createObjectURL(new Blob([data.analyticsCSV], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'analytics.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}
