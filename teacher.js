import { TEAMS, STAGES, STAGE_LABELS, TEAM_QUESTIONS } from "./data.js";
import { db, ref, onValue, set, update, runTransaction } from "./firebase.js";

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
  let currentStage = "waiting";

  // ---- المرحلة الحالية + شريط التقدم ----
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
    document.getElementById("nextStageBtn").disabled = idx >= STAGES.length - 1;
  });

  document.getElementById("nextStageBtn").onclick = async () => {
    const idx = STAGES.indexOf(currentStage);
    if (idx < STAGES.length - 1) {
      await set(ref(db, "session/currentStage"), STAGES[idx + 1]);
    }
  };

  // ---- بطاقات الفرق ----
  const teamsGrid = document.getElementById("teamsGrid");
  teamsGrid.innerHTML = "";
  TEAMS.forEach((team) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-head">
        <h3>${team.name}</h3>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="score-badge" id="score-${team.id}">0</span>
          <button class="btn-point" data-team="${team.id}">+</button>
        </div>
      </div>
      <div>
        <label>سؤال الفريق</label>
        <div class="question-box" style="font-size:13px;">
          ${TEAM_QUESTIONS[team.id]?.imageUrl ? `<img src="${TEAM_QUESTIONS[team.id].imageUrl}" style="max-width:100%; border-radius:8px; margin-bottom:8px;"/>` : ""}
          ${TEAM_QUESTIONS[team.id]?.text?.replace(/\n/g, "<br/>") || ""}
        </div>
        ${TEAM_QUESTIONS[team.id]?.correctAnswer ? `<span class="status-tag done" style="margin-top:6px;">الإجابة الصحيحة: ${TEAM_QUESTIONS[team.id].correctAnswer}</span>` : ""}
      </div>
      <div>
        <label>الإجابة المختارة من الفريق</label>
        <div class="answer-text" id="answer-${team.id}">لم تُجب بعد</div>
      </div>
      <div>
        <label>العمل المرفوع من Canva</label>
        <div id="upload-${team.id}"></div>
      </div>
    `;
    teamsGrid.appendChild(card);
  });

  // زر النقاط
  teamsGrid.querySelectorAll(".btn-point").forEach((btn) => {
    btn.onclick = () => {
      const teamId = btn.dataset.team;
      runTransaction(ref(db, `teams/${teamId}/score`), (cur) => (cur || 0) + 1);
    };
  });

  // استماع فوري للنقاط، الإجابات، والرفع لكل فريق
  TEAMS.forEach((team) => {
    onValue(ref(db, `teams/${team.id}/score`), (snap) => {
      document.getElementById(`score-${team.id}`).textContent = snap.val() || 0;
    });
    onValue(ref(db, `answers/${team.id}/text`), (snap) => {
      const el = document.getElementById(`answer-${team.id}`);
      const correct = TEAM_QUESTIONS[team.id]?.correctAnswer;
      if (snap.exists() && snap.val()) {
        const chosen = snap.val();
        const isCorrect = correct && chosen === correct;
        el.innerHTML = `${chosen} ${isCorrect ? "✅" : (correct ? "❌" : "")}`;
      } else {
        el.textContent = "لم تُجب بعد";
      }
    });
    onValue(ref(db, `uploads/${team.id}/url`), (snap) => {
      const el = document.getElementById(`upload-${team.id}`);
      if (snap.exists()) {
        el.innerHTML = `<img class="upload-thumb" src="${snap.val()}" />`;
      } else {
        el.innerHTML = `<span class="status-tag pending">لم يُرفع عمل بعد</span>`;
      }
    });
  });

  // ---- التصويت ----
  onValue(ref(db, "votes"), (snap) => {
    const votes = snap.val() || {};
    const counts = {};
    TEAMS.forEach((t) => (counts[t.id] = 0));
    Object.values(votes).forEach((choice) => {
      if (counts[choice] !== undefined) counts[choice]++;
    });
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

  // ---- إعلان الفائز ----
  document.getElementById("announceWinnerBtn").onclick = async () => {
    const votesSnap = await new Promise((res) => onValue(ref(db, "votes"), res, { onlyOnce: true }));
    const votes = votesSnap.val() || {};
    const counts = {};
    TEAMS.forEach((t) => (counts[t.id] = 0));
    Object.values(votes).forEach((choice) => { if (counts[choice] !== undefined) counts[choice]++; });

    let winnerId = null, max = -1;
    Object.entries(counts).forEach(([id, c]) => { if (c > max) { max = c; winnerId = id; } });

    await set(ref(db, "session/winner"), winnerId);
    renderWinner(winnerId);
  };

  onValue(ref(db, "session/winner"), (snap) => {
    if (snap.exists()) renderWinner(snap.val());
  });

  function renderWinner(winnerId) {
    const team = TEAMS.find((t) => t.id === winnerId);
    const box = document.getElementById("winnerBox");
    if (!team) { box.innerHTML = ""; return; }
    box.innerHTML = `
      <div class="winner-banner">
        <div class="trophy">🏆</div>
        <h2>الفريق الفائز: ${team.name}</h2>
      </div>
    `;
  }

  // ---- تصفير كامل ----
  document.getElementById("resetBtn").onclick = async () => {
    if (!confirm("هل أنتِ متأكدة من تصفير كل البيانات (الإجابات، النقاط، التصويت)؟")) return;
    await set(ref(db, "session"), { currentStage: "waiting" });
    await set(ref(db, "answers"), null);
    await set(ref(db, "votes"), null);
    await set(ref(db, "uploads"), null);
    const resetScores = {};
    TEAMS.forEach((t) => (resetScores[t.id] = { score: 0 }));
    await set(ref(db, "teams"), resetScores);
    document.getElementById("winnerBox").innerHTML = "";
  };
}
