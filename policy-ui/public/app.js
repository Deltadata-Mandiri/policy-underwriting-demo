'use strict';

// ---- helpers ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function idr(n) {
  const num = Number(n) || 0;
  return 'Rp ' + num.toLocaleString('id-ID');
}

// very small, safe markdown -> HTML (headings, bold, lists, paragraphs)
function renderMarkdown(md) {
  if (!md) return '<em>Surat tidak tersedia.</em>';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = String(md).replace(/```[a-z]*\n?/gi, '').split(/\r?\n/);
  let html = '', inList = false;
  for (let raw of lines) {
    let line = esc(raw.trim());
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (/^#{1,6}\s/.test(raw.trim())) {
      if (inList) { html += '</ul>'; inList = false; }
      const level = raw.trim().match(/^#+/)[0].length;
      html += `<h${Math.min(level + 1, 4)}>${line.replace(/^#+\s/, '')}</h${Math.min(level + 1, 4)}>`;
    } else if (/^[-*]\s/.test(raw.trim())) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.replace(/^[-*]\s/, '')}</li>`;
    } else if (line === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${line}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

// Map the workflow's finalStatus / lifecycle status onto a coloured pill.
function setStatusPill(status, finalStatus, awaitingReview) {
  const pill = $('statusPill');
  let text = status, cls = '';
  if (awaitingReview) { text = 'PERLU TINJAUAN'; cls = 'warn'; }
  else if (finalStatus === 'ACCEPTED_STANDARD') { text = 'DISETUJUI · STANDAR'; cls = 'ok'; }
  else if (finalStatus === 'ACCEPTED_RATED') { text = 'DISETUJUI · RATED'; cls = 'ok'; }
  else if (finalStatus === 'DECLINED') { text = 'DITOLAK'; cls = 'bad'; }
  else if (finalStatus === 'POSTPONED') { text = 'DITUNDA'; cls = 'warn'; }
  else if (status === 'RUNNING') { text = 'DIPROSES'; cls = 'warn'; }
  else if (status === 'COMPLETED') { text = 'SELESAI'; cls = 'ok'; }
  else if (status === 'FAILED' || status === 'TERMINATED') { text = 'GAGAL'; cls = 'bad'; }
  pill.textContent = text;
  pill.className = 'status-pill ' + cls;
}

// ---- state -----------------------------------------------------------------
let currentId = null;
let polling = null;

function showProgress(msg) {
  $('progress').hidden = false;
  $('progressText').textContent = msg || 'Memproses pengajuan…';
  $('decision').hidden = true;
  $('reviewPanel').hidden = true;
  $('errorBox').hidden = true;
}
function showError(msg) {
  $('progress').hidden = true;
  const box = $('errorBox');
  box.hidden = false;
  box.textContent = 'Terjadi kesalahan: ' + msg;
}

// Empty when served by server.js locally (same origin serves /api/*); set to the
// Lambda Function URL by an Amplify build. See public/config.js.
const API_BASE = ((window.APP_CONFIG && window.APP_CONFIG.apiBase) || '').replace(/\/+$/, '');

async function api(url, opts) {
  const res = await fetch(API_BASE + url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// Gather checkbox group into an array of the checked values.
function collectGroup(group) {
  return Array.from(
    document.querySelectorAll(`.checkgroup[data-group="${group}"] input:checked`)
  ).map((el) => el.value);
}

// ---- flows -----------------------------------------------------------------
const NUMERIC = ['sumAssured', 'policyTermYears', 'annualIncome', 'occupationClass', 'heightCm', 'weightKg'];

async function submitApplication(e) {
  e.preventDefault();
  const form = $('applicationForm');
  const fd = new FormData(form);
  const input = {};
  for (const [k, v] of fd.entries()) {
    if (NUMERIC.includes(k)) input[k] = Number(v);
    else if (k === 'smoker') input[k] = v === 'true';
    else input[k] = v;
  }
  input.medicalConditions = collectGroup('medicalConditions');
  input.familyHistory = collectGroup('familyHistory');
  input.hazardousHobbies = collectGroup('hazardousHobbies');
  // Age is derived from dateOfBirth against asOfDate; use today for a live run.
  input.asOfDate = new Date().toISOString().slice(0, 10);

  $('resultCard').hidden = false;
  $('resultCard').scrollIntoView({ behavior: 'smooth' });
  setStatusPill('RUNNING');
  showProgress('Mengirim pengajuan ke Conductor…');
  $('submitBtn').disabled = true;

  try {
    const { workflowId } = await api('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    currentId = workflowId;
    startPolling();
  } catch (err) {
    showError(err.message);
    $('submitBtn').disabled = false;
  }
}

function startPolling() {
  clearInterval(polling);
  polling = setInterval(poll, 1500);
  poll();
}

async function poll() {
  if (!currentId) return;
  try {
    const wf = await api('/api/applications/' + currentId);
    if (wf.awaitingReview) {
      clearInterval(polling);
      renderDecision(wf.output, wf.status, true);
      return;
    }
    if (wf.status === 'RUNNING') {
      showProgress('Menilai risiko & menyusun surat keputusan…');
      return;
    }
    // terminal
    clearInterval(polling);
    $('submitBtn').disabled = false;
    renderDecision(wf.output, wf.status, false);
    if (wf.status !== 'COMPLETED') {
      showError('Alur kerja berakhir dengan status: ' + wf.status);
    }
  } catch (err) {
    clearInterval(polling);
    $('submitBtn').disabled = false;
    showError(err.message);
  }
}

function renderDecision(o, status, awaitingReview) {
  $('progress').hidden = true;
  $('decision').hidden = false;
  o = o || {};
  setStatusPill(status, o.finalStatus, awaitingReview);

  $('mScore').textContent = o.riskScore != null ? o.riskScore : '—';
  $('mClass').textContent = o.riskClass || o.band || '—';
  $('mLoading').textContent = o.loadingPct != null ? '+' + o.loadingPct + '%' : '—';
  $('mAnnual').textContent = o.annualPremium ? idr(o.annualPremium) : '—';
  $('mMonthly').textContent = o.monthlyPremium ? idr(o.monthlyPremium) : '—';
  $('mAgeBmi').textContent = (o.age != null ? o.age + ' th' : '—') + ' / ' + (o.bmi != null ? o.bmi : '—');

  const reasons = o.reasonCodes || [];
  $('reasonList').innerHTML = reasons.length
    ? reasons.map((r) => `<li>${r}</li>`).join('')
    : '<li>Tidak ada faktor risiko tercatat (risiko preferred).</li>';

  const exclusions = o.exclusions || [];
  $('exclusionsWrap').hidden = exclusions.length === 0;
  $('exclusionList').innerHTML = exclusions.map((x) => `<li>${x}</li>`).join('');

  $('letterBody').innerHTML = renderMarkdown(o.decisionLetterMarkdown);

  $('reviewPanel').hidden = !awaitingReview;
}

async function submitReview() {
  const decision = {
    decision: $('rvDecision').value,
    loadingPct: Number($('rvLoading').value),
    note: $('rvNote').value,
    reviewedBy: $('rvBy').value,
  };
  $('submitReview').disabled = true;
  try {
    await api('/api/applications/' + currentId + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    });
    $('reviewPanel').hidden = true;
    showProgress('Menerapkan keputusan & menyusun surat…');
    startPolling();
  } catch (err) {
    showError(err.message);
  } finally {
    $('submitReview').disabled = false;
  }
}

// ---- sample fillers --------------------------------------------------------
function fill(values) {
  const form = $('applicationForm');
  // clear all checkboxes first
  document.querySelectorAll('.checkgroup input:checked').forEach((el) => { el.checked = false; });
  for (const [k, v] of Object.entries(values)) {
    if (Array.isArray(v)) {
      v.forEach((val) => {
        const el = document.querySelector(`.checkgroup input[value="${val}"]`);
        if (el) el.checked = true;
      });
    } else if (form.elements[k]) {
      form.elements[k].value = v;
    }
  }
}
const SAMPLES = {
  rated: { fullName: 'Dewi Lestari', applicationId: 'POL-2002', gender: 'F', dateOfBirth: '1984-01-10', sumAssured: 1000000000, policyTermYears: 15, annualIncome: 600000000, occupationClass: '1', smoker: 'false', heightCm: 178, weightKg: 89, medicalConditions: ['high_cholesterol'] },
  refer: { fullName: 'Slamet Riyadi', applicationId: 'POL-3003', gender: 'M', dateOfBirth: '1971-04-12', sumAssured: 500000000, policyTermYears: 10, annualIncome: 300000000, occupationClass: '1', smoker: 'true', heightCm: 172, weightKg: 92, medicalConditions: [] },
  largeCase: { fullName: 'Hendra Gunawan', applicationId: 'POL-3004', gender: 'M', dateOfBirth: '1986-06-01', sumAssured: 6000000000, policyTermYears: 20, annualIncome: 800000000, occupationClass: '1', smoker: 'false', heightCm: 180, weightKg: 78, medicalConditions: [] },
  decline: { fullName: 'Bambang Sutrisno', applicationId: 'POL-4004', gender: 'M', dateOfBirth: '1979-08-20', sumAssured: 500000000, policyTermYears: 15, annualIncome: 300000000, occupationClass: '1', smoker: 'false', heightCm: 170, weightKg: 72, medicalConditions: ['active_cancer'], familyHistory: ['cancer_before_60'] },
  postpone: { fullName: 'Rina Marlina', applicationId: 'POL-5005', gender: 'F', dateOfBirth: '1990-03-03', sumAssured: 700000000, policyTermYears: 20, annualIncome: 400000000, occupationClass: '1', smoker: 'false', heightCm: 165, weightKg: 60, medicalConditions: ['pending_surgery'] },
};

function resetForNew() {
  clearInterval(polling);
  currentId = null;
  $('resultCard').hidden = true;
  $('submitBtn').disabled = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- wire up ---------------------------------------------------------------
$('applicationForm').addEventListener('submit', submitApplication);
$('submitReview').addEventListener('click', submitReview);
$('newApp').addEventListener('click', resetForNew);
$('fillRated').addEventListener('click', () => fill(SAMPLES.rated));
$('fillRefer').addEventListener('click', () => fill(SAMPLES.refer));
$('fillLargeCase').addEventListener('click', () => fill(SAMPLES.largeCase));
$('fillDecline').addEventListener('click', () => fill(SAMPLES.decline));
$('fillPostpone').addEventListener('click', () => fill(SAMPLES.postpone));
