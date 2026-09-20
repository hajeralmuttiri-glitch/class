import { TEAMS, STAGES, STAGE_LABELS, STAGE_DURATIONS, VOTING_CRITERIA, TEAM_QUESTIONS, CANVA_LINK } from "./data.js";
import { db, ref, onValue, set, runTransaction } from "./firebase.js";

// ============================================================
// كلمة مرور المعلمة — غيّريها هنا
// ============================================================
const TEACHER_PASSWORD = "chart2025";

const gate = document.getElementById("gate");
const dashboard = document.getElementById("dashboard");
const pwInput = document.getElementById("pwInput");
const pwBtn = document.getElementById("pwBtn");
const pwError = document.getElementById("pwError");

function tryLogin() {
  if (pwInput.value === TEACHER_PASSWORD) {
    sessionStorage.setItem("teacherAuthed", "1");
    gate.style.display = "none";
    dashboard.style.display = "block";
    initDashboard();
  } else {
    pwError.textContent = "كلمة المرور غير صحيحة";
  }
}
pwBtn.onclick = tryLogin;
pwInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });

if (sessionStorage.getItem("teacherAuthed") === "1") {
  gate.style.display = "none";
  dashboard.style.display = "block";
  initDashboard();
}

// ============================================================
function initDashboard() {
  document.getElementById("canvaLinkRef").innerHTML = `<a href="${CANVA_LINK}" target="_blank" style="color: var(--accent);">${CANVA_LINK}</a>`;
  let currentStage = "waiting";
  const COMPETITION_DURATION_MS = 60 * 60 * 1000; // ساعة واحدة كاملة — غيّري الرقم لو حبيتِ

  // ---- شريط التقدم ----
  const progressSteps = document.getElementById("progressSteps");
  progressSteps.innerHTML = "";
  STAGES.forEach((s) => {
    const div = document.createElement("div");
    div.className = "step";
    div.textContent = STAGE_LABELS[s];
    div.id = "step-" + s;
    progressSteps.appendChild(div);
  });
  function renderProgress() {
    const idx = STAGES.indexOf(currentStage);
    STAGES.forEach((s, i) => {
      const el = document.getElementById("step-" + s);
      el.classList.remove("active", "done");
      if (i < idx) el.classList.add("done");
      if (i === idx) el.classList.add("active");
    });
  }

  onValue(ref(db, "session/currentStage"), (snap) => {
    currentStage = snap.val() || "waiting";
    document.getElementById("stagePill").textContent = STAGE_LABELS[currentStage];
    renderProgress();
    const idx = STAGES.indexOf(currentStage);
    const btn = document.getElementById("nextStageBtn");
    btn.disabled = idx >= STAGES.length - 1;
    btn.textContent = currentStage === "waiting" ? "🚀 ابدأ المسابقة" : "المرحلة التالية ⬅";
  });

  // ---- الانتقال بين المراحل (المعلمة فقط تتحكم) ----
  document.getElementById("nextStageBtn").onclick = async () => {
    const idx = STAGES.indexOf(currentStage);
    if (idx >= STAGES.length - 1) return;
    const nextStage = STAGES[idx + 1];
    const wasWaiting = currentStage === "waiting";

    await set(ref(db, "session/currentStage"), nextStage);
    await set(ref(db, "session/stageStartTime"), Date.now()); // لمؤقت المرحلة (120ث/6د)

    if (wasWaiting) {
      await set(ref(db, "session/competitionStartTime"), Date.now()); // لساعة التصفير التلقائي
    }
    if (nextStage === "gallery_voting") {
      await generateAnonLabels();
    }
  };

  // ---- مؤقت المرحلة الحالية (يظهر للمعلمة أيضًا) ----
  let stageTimerInterval = null;
  onValue(ref(db, "session/stageStartTime"), (snap) => {
    const startTime = snap.val();
    if (stageTimerInterval) clearInterval(stageTimerInterval);
    const durationSec = STAGE_DURATIONS[currentStage];
    const pill = document.getElementById("timerPill");
    if (!startTime || !durationSec) { pill.style.display = "none"; return; }
    pill.style.display = "inline-flex";
    stageTimerInterval = setInterval(() => {
      const remaining = durationSec * 1000 - (Date.now() - startTime);
      if (remaining <= 0) { pill.textContent = "⏱ انتهى الوقت"; clearInterval(stageTimerInterval); return; }
      const m = Math.floor(remaining / 60000), s = Math.floor((remaining % 60000) / 1000);
      pill.textContent = `⏱ ${m}:${s.toString().padStart(2, "0")}`;
    }, 1000);
  });

  // ---- ساعة الحصة الكاملة (تصفير تلقائي بعد ساعة) ----
  let sessionTimerInterval = null;
  onValue(ref(db, "session/competitionStartTime"), (snap) => {
    const startTime = snap.val();
    if (sessionTimerInterval) clearInterval(sessionTimerInterval);
    const el = document.getElementById("sessionTimer");
    if (!startTime) { if (el) el.textContent = ""; return; }
    sessionTimerInterval = setInterval(() => {
      const remaining = COMPETITION_DURATION_MS - (Date.now() - startTime);
      if (remaining <= 0) { clearInterval(sessionTimerInterval); resetScoresOnly(); return; }
      const m = Math.floor(remaining / 60000), s = Math.floor((remaining % 60000) / 1000);
      if (el) el.textContent = `⏱ الوقت المتبقي للحصة: ${m}:${s.toString().padStart(2, "0")}`;
    }, 1000);
  });

  // ---- بطاقات الفرق ----
  const teamsGrid = document.getElementById("teamsGrid");
  teamsGrid.innerHTML = "";
  TEAMS.forEach((team) => {
    const card = document.createElement("div");
    card.className = "card";
    card.id = `card-${team.id}`;
    card.innerHTML = `
      <div class="card-head">
        <h3>${team.name}</h3>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="score-badge" id="score-${team.id}">0</span>
          <button class="btn-point" data-team="${team.id}">+</button>
        </div>
      </div>
      <div>
        <label>سؤال أنواع المخططات (المرحلة 3)</label>
        <div class="question-box" style="font-size:12px;">
          ${TEAM_QUESTIONS[team.id]?.imageUrl ? `<img src="${TEAM_QUESTIONS[team.id].imageUrl}" style="max-width:100%; border-radius:8px; margin-bottom:8px;"/>` : ""}
          ${TEAM_QUESTIONS[team.id]?.text?.replace(/\n/g, "<br/>") || ""}
        </div>
        ${TEAM_QUESTIONS[team.id]?.correctAnswer ? `<span class="status-tag done" style="margin-top:6px;">الإجابة الصحيحة: ${TEAM_QUESTIONS[team.id].correctAnswer}</span>` : ""}
      </div>
      <div><label>الإجابة المختارة (المرحلة 3)</label><div class="answer-text" id="quiz-${team.id}">لم تُجب بعد</div></div>
      <div><label>تبرير الاختيار</label><div class="answer-text" id="justify-${team.id}">—</div></div>
      <div><label>تعريف المخطط (المرحلة 1)</label><div class="answer-text" id="define-${team.id}">—</div></div>
      <div><label>مزايا المخطط (المرحلة 2)</label><div class="answer-text" id="adv-${team.id}">—</div></div>
      <div><label>التصميم المرفوع (المرحلة 4)</label><div id="upload-${team.id}"></div></div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="btn-danger disq-btn" data-team="${team.id}" style="font-size:13px; padding:8px 14px;">استبعاد الفريق</button>
        <span id="disq-badge-${team.id}"></span>
      </div>
    `;
    teamsGrid.appendChild(card);
  });

  teamsGrid.querySelectorAll(".btn-point").forEach((btn) => {
    btn.onclick = () => {
      runTransaction(ref(db, `teams/${btn.dataset.team}/score`), (cur) => (cur || 0) + 1);
    };
  });

  teamsGrid.querySelectorAll(".disq-btn").forEach((btn) => {
    btn.onclick = async () => {
      const teamId = btn.dataset.team;
      const current = await new Promise((res) => onValue(ref(db, `session/disqualified/${teamId}`), res, { onlyOnce: true }));
      const isDisq = !!current.val();
      if (!isDisq && !confirm("هل أنتِ متأكدة من استبعاد هذا الفريق؟")) return;
      await set(ref(db, `session/disqualified/${teamId}`), !isDisq);
    };
  });

  TEAMS.forEach((team) => {
    onValue(ref(db, `teams/${team.id}/score`), (snap) => {
      document.getElementById(`score-${team.id}`).textContent = snap.val() || 0;
    });
    onValue(ref(db, `answers/define/${team.id}`), (snap) => {
      document.getElementById(`define-${team.id}`).textContent = snap.exists() && snap.val() ? snap.val() : "—";
    });
    onValue(ref(db, `answers/advantages/${team.id}`), (snap) => {
      document.getElementById(`adv-${team.id}`).textContent = snap.exists() && snap.val() ? snap.val() : "—";
    });
    onValue(ref(db, `answers/quizJustification/${team.id}`), (snap) => {
      document.getElementById(`justify-${team.id}`).textContent = snap.exists() && snap.val() ? snap.val() : "—";
    });
    onValue(ref(db, `answers/quiz/${team.id}`), (snap) => {
      const el = document.getElementById(`quiz-${team.id}`);
      const correct = TEAM_QUESTIONS[team.id]?.correctAnswer;
      if (snap.exists() && snap.val()) {
        const chosen = snap.val();
        el.innerHTML = `${chosen} ${correct && chosen === correct ? "✅" : correct ? "❌" : ""}`;
      } else {
        el.textContent = "لم تُجب بعد";
      }
    });
    onValue(ref(db, `uploads/${team.id}/url`), (snap) => {
      const el = document.getElementById(`upload-${team.id}`);
      el.innerHTML = snap.exists()
        ? `<img class="upload-thumb" src="${snap.val()}" />`
        : `<span class="status-tag pending">لم يُرفع عمل بعد</span>`;
    });
    onValue(ref(db, `session/disqualified/${team.id}`), (snap) => {
      const badge = document.getElementById(`disq-badge-${team.id}`);
      const card = document.getElementById(`card-${team.id}`);
      const isDisq = !!snap.val();
      badge.innerHTML = isDisq ? `<span class="status-tag pending">🚫 مستبعد</span>` : "";
      card.style.opacity = isDisq ? "0.55" : "1";
    });
  });

  // ---- توليد رموز التصويت المجهولة (أ/ب/ج...) ----
  async function generateAnonLabels() {
    const arabicLetters = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];
    const shuffled = [...TEAMS].sort(() => Math.random() - 0.5);
    const labels = {};
    shuffled.forEach((t, i) => (labels[t.id] = arabicLetters[i] || String(i + 1)));
    await set(ref(db, "session/anonLabels"), labels);
  }

  // ---- نتائج التصويت (بأسماء الفرق الحقيقية للمعلمة فقط) ----
  document.getElementById("criteriaList").innerHTML = VOTING_CRITERIA.map(
    (c) => `<div style="margin-bottom:8px;"><strong>${c.title}:</strong> ${c.desc}</div>`
  ).join("");

  onValue(ref(db, "votes"), (snap) => {
    const votes = snap.val() || {};
    const counts = {};
    TEAMS.forEach((t) => (counts[t.id] = 0));
    Object.values(votes).forEach((choice) => { if (counts[choice] !== undefined) counts[choice]++; });
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;

    const box = document.getElementById("voteResults");
    box.innerHTML = "";
    TEAMS.forEach((t) => {
      const pct = Math.round((counts[t.id] / total) * 100);
      const row = document.createElement("div");
      row.className = "vote-row";
      row.style.marginBottom = "10px";
      row.innerHTML = `
        <span style="width:140px;">${t.name}</span>
        <div class="vote-bar-outer"><div class="vote-bar-inner" style="width:${pct}%"></div></div>
        <span style="width:60px; text-align:left;">${counts[t.id]}</span>
      `;
      box.appendChild(row);
    });
  });

  document.getElementById("announceWinnerBtn").onclick = async () => {
    const [votesSnap, disqSnap] = await Promise.all([
      new Promise((res) => onValue(ref(db, "votes"), res, { onlyOnce: true })),
      new Promise((res) => onValue(ref(db, "session/disqualified"), res, { onlyOnce: true })),
    ]);
    const votes = votesSnap.val() || {};
    const disqualified = disqSnap.val() || {};
    const counts = {};
    TEAMS.forEach((t) => (counts[t.id] = 0));
    Object.values(votes).forEach((choice) => { if (counts[choice] !== undefined) counts[choice]++; });

    let winnerId = null, max = -1;
    Object.entries(counts).forEach(([id, c]) => {
      if (disqualified[id]) return;
      if (c > max) { max = c; winnerId = id; }
    });

    await set(ref(db, "session/winner"), winnerId);
    renderWinner(winnerId);
  };

  onValue(ref(db, "session/winner"), (snap) => { if (snap.exists()) renderWinner(snap.val()); });

  document.getElementById("revealResultsBtn").onclick = async () => {
    if (!confirm("سيتم عرض النتيجة النهائية والفائز لجميع الطالبات الآن على أجهزتهن. متابعة؟")) return;
    await set(ref(db, "session/resultsRevealed"), true);
  };

  function renderWinner(winnerId) {
    const team = TEAMS.find((t) => t.id === winnerId);
    const box = document.getElementById("winnerBox");
    if (!team) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="winner-banner"><div class="trophy">🏆</div><h2>الفريق الفائز: ${team.name}</h2></div>`;
  }

  // ---- تصفير نقاط التعزيز فقط (لا يمسّ الإجابات أو التصاميم أو التصويت أو بيانات الحصة) ----
  async function resetScoresOnly() {
    const resetScores = {};
    TEAMS.forEach((t) => (resetScores[t.id] = { score: 0 }));
    await set(ref(db, "teams"), resetScores);
  }

  document.getElementById("resetBtn").onclick = async () => {
    if (!confirm("سيتم تصفير نقاط التعزيز فقط لكل الفرق. لن يُحذف أي إجابات أو تصاميم أو تصويت. متابعة؟")) return;
    await resetScoresOnly();
  };
}
