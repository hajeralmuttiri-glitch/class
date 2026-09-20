import { TEAMS, STAGES, STAGE_LABELS, STAGE_DURATIONS, VOTING_CRITERIA, TEAM_QUESTIONS, CANVA_LINK } from "./data.js";
import {
  db, storage, ref, onValue, set,
  storageRef, uploadBytes, getDownloadURL,
} from "./firebase.js";

const teamSelectSection = document.getElementById("teamSelectSection");
const mainSection = document.getElementById("mainSection");
const teamSelectGrid = document.getElementById("teamSelectGrid");
const myTeamLabel = document.getElementById("myTeamLabel");
const stagePill = document.getElementById("stagePill");
const timerPill = document.getElementById("timerPill");
const changeTeamBtn = document.getElementById("changeTeamBtn");

const panels = {
  waiting: document.getElementById("panel-waiting"),
  define: document.getElementById("panel-define"),
  advantages: document.getElementById("panel-advantages"),
  quiz: document.getElementById("panel-quiz"),
  design: document.getElementById("panel-design"),
  gallery_voting: document.getElementById("panel-gallery_voting"),
  results: document.getElementById("panel-results"),
};

let myTeam = localStorage.getItem("myTeam");
let currentStage = "waiting";
let timerInterval = null;

// ---------- اختيار الفريق ----------
function renderTeamSelect() {
  teamSelectGrid.innerHTML = "";
  TEAMS.forEach((t) => {
    const btn = document.createElement("button");
    btn.textContent = t.name;
    btn.onclick = () => {
      myTeam = t.id;
      localStorage.setItem("myTeam", t.id);
      showMain();
    };
    teamSelectGrid.appendChild(btn);
  });
}

function showMain() {
  const team = TEAMS.find((t) => t.id === myTeam);
  if (!team) { showTeamSelect(); return; }
  myTeamLabel.textContent = "فريقكِ: " + team.name;
  teamSelectSection.style.display = "none";
  mainSection.style.display = "block";
  loadTeamSpecificData();
}

function showTeamSelect() {
  mainSection.style.display = "none";
  teamSelectSection.style.display = "block";
  renderTeamSelect();
}

changeTeamBtn.onclick = () => {
  localStorage.removeItem("myTeam");
  myTeam = null;
  showTeamSelect();
};

// ---------- لوحة التعزيز (تظهر دائمًا وتتحدث لحظيًا) ----------
function initLeaderboard() {
  const scores = {};
  TEAMS.forEach((t) => (scores[t.id] = 0));

  function render() {
    const list = document.getElementById("leaderboardList");
    if (!list) return;
    const sorted = [...TEAMS].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
    const medals = ["🥇", "🥈", "🥉"];
    list.innerHTML = sorted.map((t, i) => `
      <div class="leaderboard-row ${i === 0 ? "top1" : ""}">
        <span>${medals[i] || "🔹"} ${t.name}</span>
        <span class="lb-score">${scores[t.id] || 0} نقطة</span>
      </div>
    `).join("");
  }

  TEAMS.forEach((t) => {
    onValue(ref(db, `teams/${t.id}/score`), (snap) => {
      scores[t.id] = snap.val() || 0;
      render();
    });
  });
}
initLeaderboard();

// ---------- النتيجة النهائية (تُكشف فقط بضغطة المعلمة) ----------
onValue(ref(db, "session/resultsRevealed"), (snap) => {
  const revealed = !!snap.val();
  const waitingBox = document.getElementById("resultsWaiting");
  const revealedBox = document.getElementById("resultsRevealed");
  if (!waitingBox || !revealedBox) return;
  if (!revealed) {
    waitingBox.style.display = "block";
    revealedBox.style.display = "none";
    return;
  }
  waitingBox.style.display = "none";
  revealedBox.style.display = "block";
  renderFinalResults();
});

async function renderFinalResults() {
  const [winnerSnap, scoresSnaps] = await Promise.all([
    new Promise((res) => onValue(ref(db, "session/winner"), res, { onlyOnce: true })),
    Promise.all(TEAMS.map((t) => new Promise((res) => onValue(ref(db, `teams/${t.id}/score`), res, { onlyOnce: true })))),
  ]);
  const winnerId = winnerSnap.val();
  const winnerTeam = TEAMS.find((t) => t.id === winnerId);
  const scored = TEAMS.map((t, i) => ({ ...t, score: scoresSnaps[i].val() || 0 }));
  scored.sort((a, b) => b.score - a.score);
  const medals = ["🥇", "🥈", "🥉"];

  const box = document.getElementById("resultsRevealed");
  box.innerHTML = `
    ${winnerTeam ? `
      <div class="winner-banner">
        <div class="trophy">🏆</div>
        <h2>الفريق الفائز: ${winnerTeam.name}</h2>
      </div>
    ` : ""}
    <h3 style="margin-top:20px;">الترتيب النهائي</h3>
    ${scored.map((t, i) => `
      <div class="leaderboard-row ${i === 0 ? "top1" : ""}">
        <span>${medals[i] || "🔹"} ${t.name}</span>
        <span class="lb-score">${t.score} نقطة</span>
      </div>
    `).join("")}
  `;
}

// ---------- المرحلة الحالية ----------
onValue(ref(db, "session/currentStage"), (snap) => {
  currentStage = snap.val() || "waiting";
  stagePill.textContent = STAGE_LABELS[currentStage] || "—";
  Object.values(panels).forEach((p) => (p.style.display = "none"));
  if (panels[currentStage]) panels[currentStage].style.display = "flex";
  if (currentStage === "gallery_voting") renderGallery();
});

// ---------- المؤقت (نفس الوقت على كل الأجهزة) ----------
onValue(ref(db, "session/stageStartTime"), (snap) => {
  const startTime = snap.val();
  if (timerInterval) clearInterval(timerInterval);
  const durationSec = STAGE_DURATIONS[currentStage];
  if (!startTime || !durationSec) {
    timerPill.style.display = "none";
    return;
  }
  timerPill.style.display = "inline-flex";
  timerInterval = setInterval(() => {
    const remaining = durationSec * 1000 - (Date.now() - startTime);
    if (remaining <= 0) {
      timerPill.textContent = "⏱ انتهى الوقت";
      clearInterval(timerInterval);
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    timerPill.textContent = `⏱ ${mins}:${secs.toString().padStart(2, "0")}`;
  }, 1000);
});

// ---------- تحميل بيانات الفريق حسب المرحلة ----------
function loadTeamSpecificData() {
  if (!myTeam) return;

  // المرحلة 1: التعريف
  const defineText = document.getElementById("defineText");
  onValue(ref(db, `answers/define/${myTeam}`), (snap) => {
    if (snap.exists() && document.activeElement !== defineText) defineText.value = snap.val();
  });
  let defineTimeout;
  defineText.oninput = () => {
    clearTimeout(defineTimeout);
    defineTimeout = setTimeout(async () => {
      await set(ref(db, `answers/define/${myTeam}`), defineText.value);
      flashMsg("defineSavedMsg");
    }, 600);
  };

  // المرحلة 2: المزايا
  const advantagesText = document.getElementById("advantagesText");
  onValue(ref(db, `answers/advantages/${myTeam}`), (snap) => {
    if (snap.exists() && document.activeElement !== advantagesText) advantagesText.value = snap.val();
  });
  let advTimeout;
  advantagesText.oninput = () => {
    clearTimeout(advTimeout);
    advTimeout = setTimeout(async () => {
      await set(ref(db, `answers/advantages/${myTeam}`), advantagesText.value);
      flashMsg("advantagesSavedMsg");
    }, 600);
  };

  // المرحلة 3: سؤال الاختيار من متعدد
  const q = TEAM_QUESTIONS[myTeam];
  const box = document.getElementById("myQuestionBox");
  box.innerHTML = `
    ${q.imageUrl ? `<img src="${q.imageUrl}" alt="مخطط توضيحي"/>` : ""}
    ${q.title ? `<strong>${q.title}</strong><br/>` : ""}
    <span>${q.text.replace(/\n/g, "<br/>")}</span>
  `;
  const optionsBox = document.getElementById("answerOptions");
  optionsBox.innerHTML = "";
  (q.options || []).forEach((opt) => {
    const btn = document.createElement("button");
    btn.textContent = opt;
    btn.onclick = async () => {
      optionsBox.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      await set(ref(db, `answers/quiz/${myTeam}`), opt);
      flashMsg("answerSavedMsg");
    };
    optionsBox.appendChild(btn);
  });
  onValue(ref(db, `answers/quiz/${myTeam}`), (snap) => {
    if (!snap.exists()) return;
    const savedValue = snap.val();
    optionsBox.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("selected", b.textContent === savedValue);
    });
  });

  // تبرير الاختيار
  const justifyText = document.getElementById("justifyText");
  onValue(ref(db, `answers/quizJustification/${myTeam}`), (snap) => {
    if (snap.exists() && document.activeElement !== justifyText) justifyText.value = snap.val();
  });
  let justifyTimeout;
  justifyText.oninput = () => {
    clearTimeout(justifyTimeout);
    justifyTimeout = setTimeout(async () => {
      await set(ref(db, `answers/quizJustification/${myTeam}`), justifyText.value);
      flashMsg("justifySavedMsg");
    }, 600);
  };

  // المرحلة 4: رابط Canva الموحد
  const canvaLink = document.getElementById("canvaLink");
  if (canvaLink) canvaLink.href = CANVA_LINK;

  // المرحلة 4: رفع التصميم
  onValue(ref(db, `uploads/${myTeam}/url`), (snap) => {
    const img = document.getElementById("uploadPreview");
    if (snap.exists()) {
      img.src = snap.val();
      img.style.display = "block";
    }
  });
}

function flashMsg(id) {
  const msg = document.getElementById(id);
  msg.style.display = "inline-block";
  setTimeout(() => (msg.style.display = "none"), 1500);
}

document.getElementById("fileInput").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file || !myTeam) return;
  const msg = document.getElementById("uploadMsg");
  msg.textContent = "جاري الرفع...";
  msg.className = "status-tag pending";
  msg.style.display = "inline-block";
  try {
    const path = `uploads/${myTeam}/${Date.now()}-${file.name}`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, file);
    const url = await getDownloadURL(sRef);
    await set(ref(db, `uploads/${myTeam}`), { url, uploadedAt: Date.now() });
    document.getElementById("uploadPreview").src = url;
    document.getElementById("uploadPreview").style.display = "block";
    msg.textContent = "تم الرفع بنجاح ✔";
    msg.className = "status-tag done";
  } catch (err) {
    msg.textContent = "فشل الرفع، حاولي مجددًا";
    msg.className = "status-tag pending";
    console.error(err);
  }
};

// ---------- معرض التصاميم والتصويت المجهول ----------
async function renderGallery() {
  const criteriaBox = document.getElementById("criteriaBox");
  criteriaBox.innerHTML = "معايير التقييم:<br/>" + VOTING_CRITERIA.map(
    (c) => `<strong>• ${c.title}:</strong> ${c.desc}`
  ).join("<br/>");

  const [labelsSnap, uploadsSnap, disqSnap, myVoteSnap] = await Promise.all([
    new Promise((res) => onValue(ref(db, "session/anonLabels"), res, { onlyOnce: true })),
    new Promise((res) => onValue(ref(db, "uploads"), res, { onlyOnce: true })),
    new Promise((res) => onValue(ref(db, "session/disqualified"), res, { onlyOnce: true })),
    new Promise((res) => onValue(ref(db, `votes/${myTeam}`), res, { onlyOnce: true })),
  ]);
  const labels = labelsSnap.val() || {};
  const uploads = uploadsSnap.val() || {};
  const disqualified = disqSnap.val() || {};
  const myVote = myVoteSnap.val();

  const grid = document.getElementById("galleryGrid");
  grid.innerHTML = "";

  Object.entries(labels).forEach(([teamId, label]) => {
    if (disqualified[teamId]) return; // لا نعرض المستبعدين
    const upload = uploads[teamId];
    if (!upload) return;
    const isMine = teamId === myTeam;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img class="upload-thumb" style="max-height:220px;" src="${upload.url}" />
      <h3 style="text-align:center;">تصميم ${label}</h3>
      ${isMine
        ? `<span class="status-tag pending" style="align-self:center;">هذا تصميم فريقكم</span>`
        : `<button class="btn-primary vote-btn" data-team="${teamId}">صوّتي لهذا التصميم</button>`}
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".vote-btn").forEach((btn) => {
    if (myVote) {
      btn.classList.toggle("selected", btn.dataset.team === myVote);
      btn.textContent = btn.dataset.team === myVote ? "تم اختياره ✔" : "صوّتي لهذا التصميم";
    }
    btn.onclick = async () => {
      await set(ref(db, `votes/${myTeam}`), btn.dataset.team);
      grid.querySelectorAll(".vote-btn").forEach((b) => {
        b.classList.remove("selected");
        b.textContent = "صوّتي لهذا التصميم";
      });
      btn.classList.add("selected");
      btn.textContent = "تم اختياره ✔";
      flashMsg("voteMsg");
    };
  });
}

// ---------- بدء التشغيل ----------
if (myTeam) showMain();
else showTeamSelect();
