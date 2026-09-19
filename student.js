import { TEAMS, STAGES, STAGE_LABELS, TEAM_QUESTIONS } from "./data.js";
import {
  db, storage, ref, onValue, set, update,
  storageRef, uploadBytes, getDownloadURL,
} from "./firebase.js";

const teamSelectSection = document.getElementById("teamSelectSection");
const mainSection = document.getElementById("mainSection");
const teamSelectGrid = document.getElementById("teamSelectGrid");
const myTeamLabel = document.getElementById("myTeamLabel");
const stagePill = document.getElementById("stagePill");
const changeTeamBtn = document.getElementById("changeTeamBtn");

const panels = {
  waiting: document.getElementById("panel-waiting"),
  explain: document.getElementById("panel-explain"),
  voting: document.getElementById("panel-voting"),
  results: document.getElementById("panel-results"),
};

let myTeam = localStorage.getItem("myTeam");
let currentStage = "waiting";

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

// ---------- المرحلة الحالية ----------
onValue(ref(db, "session/currentStage"), (snap) => {
  currentStage = snap.val() || "waiting";
  stagePill.textContent = STAGE_LABELS[currentStage] || "—";
  Object.values(panels).forEach((p) => (p.style.display = "none"));
  if (panels[currentStage]) panels[currentStage].style.display = "flex";
});

// ---------- مرحلة الشرح: عرض السؤال + اختيار الإجابة ----------
function loadTeamSpecificData() {
  if (!myTeam) return;
  const q = TEAM_QUESTIONS[myTeam];
  const box = document.getElementById("myQuestionBox");
  box.innerHTML = `
    ${q.imageUrl ? `<img src="${q.imageUrl}" alt="مخطط توضيحي"/>` : ""}
    ${q.title ? `<strong>${q.title}</strong><br/>` : ""}
    <span>${q.text.replace(/\n/g, "<br/>")}</span>
  `;

  // بناء أزرار الخيارات
  const optionsBox = document.getElementById("answerOptions");
  optionsBox.innerHTML = "";
  let selectedValue = null;

  (q.options || []).forEach((opt) => {
    const btn = document.createElement("button");
    btn.textContent = opt;
    btn.onclick = async () => {
      selectedValue = opt;
      optionsBox.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      await set(ref(db, `answers/${myTeam}`), { text: opt, updatedAt: Date.now() });
      const msg = document.getElementById("answerSavedMsg");
      msg.style.display = "inline-block";
      setTimeout(() => (msg.style.display = "none"), 2000);
    };
    optionsBox.appendChild(btn);
  });

  // تحميل الإجابة المحفوظة سابقًا وتمييزها
  onValue(ref(db, `answers/${myTeam}/text`), (snap) => {
    if (!snap.exists()) return;
    const savedValue = snap.val();
    optionsBox.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("selected", b.textContent === savedValue);
    });
  });

  // تحميل معاينة الصورة المرفوعة سابقًا
  onValue(ref(db, `uploads/${myTeam}/url`), (snap) => {
    const img = document.getElementById("uploadPreview");
    if (snap.exists()) {
      img.src = snap.val();
      img.style.display = "block";
    }
  });

  // قائمة التصويت (كل الفرق ما عدا فريقي)
  const voteSelect = document.getElementById("voteSelect");
  voteSelect.innerHTML = "";
  TEAMS.filter((t) => t.id !== myTeam).forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    voteSelect.appendChild(opt);
  });
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

document.getElementById("voteBtn").onclick = async () => {
  const choice = document.getElementById("voteSelect").value;
  await set(ref(db, `votes/${myTeam}`), choice);
  const msg = document.getElementById("voteMsg");
  msg.style.display = "inline-block";
  setTimeout(() => (msg.style.display = "none"), 2000);
};

// ---------- بدء التشغيل ----------
if (myTeam) showMain();
else showTeamSelect();
