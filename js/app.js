import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { CATEGORIES, findCategory, findSubcategory } from "./categories.js";
import { renderLog } from "./render-log.js";

// ── DOM refs ──
// 로그인 화면에서 이메일 입력을 받지 않고, 이 고정 계정으로 로그인합니다.
// Firebase 콘솔 > Authentication 에 이 이메일로 사용자를 만들고 비밀번호를 지인들과 공유하세요.
const SHARED_LOGIN_EMAIL = "user@gmail.com";

const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const categoryNav = document.getElementById("category-nav");

const views = {
  home: document.getElementById("home-view"),
  list: document.getElementById("list-view"),
  editor: document.getElementById("editor-view"),
  viewer: document.getElementById("viewer-view"),
};

// ── 인증 ──
loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, SHARED_LOGIN_EMAIL, loginPassword.value);
  } catch (e) {
    console.error("로그인 실패:", e.code, e.message);
    if (e.code === "auth/unauthorized-domain") {
      loginError.textContent = "이 도메인이 Firebase에 승인되지 않았습니다. (auth/unauthorized-domain)";
    } else if (e.code === "auth/operation-not-allowed") {
      loginError.textContent = "이메일/비밀번호 로그인이 비활성화되어 있습니다. (auth/operation-not-allowed)";
    } else if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential") {
      loginError.textContent = "공유 계정이 아직 만들어지지 않았습니다. (" + e.code + ")";
    } else {
      loginError.textContent = "로그인 실패: 비밀번호를 확인하세요. (" + e.code + ")";
    }
  }
});

loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    buildSidebar();
    router();
  } else {
    loginScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
  }
});

// ── 사이드바 ──
function buildSidebar() {
  categoryNav.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const group = document.createElement("div");
    group.className = "cat-group";

    const header = document.createElement("div");
    header.className = "cat-header";
    header.innerHTML = `<span class="cat-icon">${cat.icon}</span><span>${cat.label}</span>`;

    const subList = document.createElement("div");
    subList.className = "subcat-list";
    cat.subcategories.forEach((sub) => {
      const item = document.createElement("div");
      item.className = "subcat-item";
      item.textContent = sub.label;
      item.dataset.cat = cat.id;
      item.dataset.sub = sub.id;
      item.addEventListener("click", () => {
        location.hash = `#/list/${cat.id}/${sub.id}`;
      });
      subList.appendChild(item);
    });

    header.addEventListener("click", () => {
      subList.classList.toggle("open");
    });

    group.appendChild(header);
    group.appendChild(subList);
    categoryNav.appendChild(group);
  });
}

document.querySelector('.site-title').addEventListener('click', () => {
  location.hash = '#/home';
});

document.getElementById('new-record-btn-home').addEventListener('click', () => {
  const firstCat = CATEGORIES[0];
  const firstSub = firstCat.subcategories[0];
  location.hash = `#/new/${firstCat.id}/${firstSub.id}`;
});

// ── 라우팅 ──
function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
}

window.addEventListener("hashchange", router);

function router() {
  const hash = location.hash.replace(/^#\//, "");
  const [route, a, b] = hash.split("/");

  if (route === "list" && a && b) {
    showView("list");
    renderListView(a, b);
  } else if (route === "new" && a && b) {
    showView("editor");
    renderEditorView({ categoryId: a, subcategoryId: b });
  } else if (route === "edit" && a) {
    showView("editor");
    renderEditorView({ recordId: a });
  } else if (route === "view" && a) {
    showView("viewer");
    renderViewerView(a);
  } else {
    showView("home");
  }
}

// ── 리스트 화면 ──
async function renderListView(catId, subId) {
  const cat = findCategory(catId);
  const sub = findSubcategory(catId, subId);
  document.getElementById("list-breadcrumb").textContent = `${cat?.label ?? catId} > ${sub?.label ?? subId}`;

  document.getElementById("new-record-btn").onclick = () => {
    location.hash = `#/new/${catId}/${subId}`;
  };

  const listEl = document.getElementById("record-list");
  listEl.innerHTML = "<li class='empty-state'>불러오는 중...</li>";

  const q = query(
    collection(db, "records"),
    where("category", "==", catId),
    where("subcategory", "==", subId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);

  if (snap.empty) {
    listEl.innerHTML = "<li class='empty-state'>아직 기록이 없습니다.</li>";
    return;
  }

  listEl.innerHTML = "";
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const li = document.createElement("li");
    const date = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString() : "";
    li.innerHTML = `<div class="record-title">${data.title || "(제목 없음)"}</div><div class="record-meta">${date}</div>`;
    li.addEventListener("click", () => {
      location.hash = `#/view/${docSnap.id}`;
    });
    listEl.appendChild(li);
  });
}

// ── 뷰어 화면 ──
async function renderViewerView(recordId) {
  const viewerContent = document.getElementById("viewer-content");
  const viewerTitle = document.getElementById("viewer-title");
  const viewerBreadcrumb = document.getElementById("viewer-breadcrumb");
  viewerContent.innerHTML = "불러오는 중...";

  const snap = await getDoc(doc(db, "records", recordId));
  if (!snap.exists()) {
    viewerContent.innerHTML = "기록을 찾을 수 없습니다.";
    return;
  }
  const data = snap.data();
  const cat = findCategory(data.category);
  const sub = findSubcategory(data.category, data.subcategory);
  viewerBreadcrumb.innerHTML = `${cat?.label ?? data.category} &gt; ${sub?.label ?? data.subcategory} &nbsp;·&nbsp; <a href="#/edit/${recordId}">수정</a>`;
  viewerTitle.textContent = data.title || "(제목 없음)";
  viewerContent.innerHTML = data.tableHtml || "";
  renderLog(viewerContent);
}

// ── 에디터 화면 ──
const recordTitleInput = document.getElementById("record-title");
const recordCategorySelect = document.getElementById("record-category");
const recordSubcategorySelect = document.getElementById("record-subcategory");
const editorContent = document.getElementById("editor-content");
const editorBreadcrumb = document.getElementById("editor-breadcrumb");

// 카테고리 select 채우기
CATEGORIES.forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat.id;
  opt.textContent = cat.label;
  recordCategorySelect.appendChild(opt);
});

function fillSubcategorySelect(catId, selectedSubId) {
  recordSubcategorySelect.innerHTML = "";
  const cat = findCategory(catId);
  if (!cat) return;
  cat.subcategories.forEach((sub) => {
    const opt = document.createElement("option");
    opt.value = sub.id;
    opt.textContent = sub.label;
    if (sub.id === selectedSubId) opt.selected = true;
    recordSubcategorySelect.appendChild(opt);
  });
}

recordCategorySelect.addEventListener("change", () => {
  fillSubcategorySelect(recordCategorySelect.value);
});

let editingRecordId = null;

async function renderEditorView({ categoryId, subcategoryId, recordId }) {
  editingRecordId = recordId || null;
  editorBreadcrumb.textContent = recordId ? "기록 수정" : "새 기록 추가";
  recordTitleInput.value = "";
  editorContent.innerHTML = "";

  if (recordId) {
    const snap = await getDoc(doc(db, "records", recordId));
    if (snap.exists()) {
      const data = snap.data();
      recordTitleInput.value = data.title || "";
      recordCategorySelect.value = data.category;
      fillSubcategorySelect(data.category, data.subcategory);
      editorContent.innerHTML = data.tableHtml || "";
    }
  } else {
    recordCategorySelect.value = categoryId;
    fillSubcategorySelect(categoryId, subcategoryId);
  }
}

// 서식 버튼 (굵게/기울임)
document.querySelectorAll("#editor-toolbar button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => {
    editorContent.focus();
    document.execCommand(btn.dataset.cmd, false, null);
  });
});

document.getElementById("color-picker").addEventListener("input", (e) => {
  editorContent.focus();
  document.execCommand("foreColor", false, e.target.value);
});

// 라이브러리 표 삽입 (첫 표: 1행 이름 / 2행 이미지)
document.getElementById("btn-insert-library").addEventListener("click", () => {
  editorContent.focus();
  const html = `<table><tbody>
    <tr><td>이름1</td><td>이름2</td><td>이름3</td></tr>
    <tr><td><img src="이미지 URL1" /></td><td><img src="이미지 URL2" /></td><td><img src="이미지 URL3" /></td></tr>
  </tbody></table><p><br></p>`;
  document.execCommand("insertHTML", false, html);
});

// 대화 표 삽입
document.getElementById("btn-insert-table").addEventListener("click", () => {
  editorContent.focus();
  const html = `<table><tbody><tr><td>이름</td><td>내용</td></tr></tbody></table><p><br></p>`;
  document.execCommand("insertHTML", false, html);
});

function lastTable() {
  const tables = editorContent.querySelectorAll("table");
  return tables.length ? tables[tables.length - 1] : null;
}

function appendRow(nameText, contentText) {
  const table = lastTable();
  if (!table) {
    alert("먼저 '대화 표 삽입'으로 표를 만들어주세요.");
    return;
  }
  let tbody = table.querySelector("tbody") || table;
  const tr = document.createElement("tr");
  const td1 = document.createElement("td");
  td1.textContent = nameText;
  const td2 = document.createElement("td");
  td2.textContent = contentText;
  tr.appendChild(td1);
  tr.appendChild(td2);
  tbody.appendChild(tr);
}

document.getElementById("btn-add-row").addEventListener("click", () => {
  appendRow("이름", "내용");
});

document.querySelectorAll("#editor-toolbar button[data-quick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const keyword = btn.dataset.quick;
    if (keyword === "/끝") {
      appendRow("/끝", "");
    } else {
      appendRow(keyword, "");
    }
  });
});

// HTML 붙여넣기 (기존 티스토리 표 HTML을 그대로 붙여넣는 기능)
const pasteModal = document.getElementById("paste-modal");
const pasteTextarea = document.getElementById("paste-textarea");

document.getElementById("btn-paste-html").addEventListener("click", () => {
  pasteTextarea.value = "";
  pasteModal.classList.remove("hidden");
});
document.getElementById("paste-cancel-btn").addEventListener("click", () => {
  pasteModal.classList.add("hidden");
});
document.getElementById("paste-confirm-btn").addEventListener("click", () => {
  editorContent.insertAdjacentHTML("beforeend", pasteTextarea.value);
  pasteModal.classList.add("hidden");
});

// 저장
document.getElementById("save-record-btn").addEventListener("click", async () => {
  const category = recordCategorySelect.value;
  const subcategory = recordSubcategorySelect.value;
  const title = recordTitleInput.value.trim();
  const tableHtml = editorContent.innerHTML;

  if (!title) {
    alert("제목을 입력해주세요.");
    return;
  }

  if (editingRecordId) {
    await updateDoc(doc(db, "records", editingRecordId), {
      title,
      category,
      subcategory,
      tableHtml,
      updatedAt: serverTimestamp(),
    });
    location.hash = `#/view/${editingRecordId}`;
  } else {
    const newDoc = await addDoc(collection(db, "records"), {
      title,
      category,
      subcategory,
      tableHtml,
      authorUid: auth.currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    location.hash = `#/view/${newDoc.id}`;
  }
});
