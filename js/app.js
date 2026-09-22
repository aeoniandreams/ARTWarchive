import {
  auth,
  db,
  adminAuth,
  adminDb,
  signInShared,
  verifyAdminPassword,
  logoutAdmin,
  logoutAll,
} from "./firebase-config.js?v=2";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  setDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { CATEGORIES, findCategory, findSubcategory } from "./categories.js?v=2";
import { renderLog, parseLibraryTable } from "./render-log.js?v=2";

// ── DOM refs ──
const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const sidebarModeBtn = document.getElementById("sidebar-mode-btn");
const sidebarAdminBadge = document.getElementById("sidebar-admin-badge");
const sidebarLogoutBtn = document.getElementById("sidebar-logout-btn");
const categoryNav = document.getElementById("category-nav");
const sidebar = document.getElementById("sidebar");
const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");

// ── 사이드바 서랍 열기/닫기 (데스크탑/모바일 공통) ──
function openSidebar() {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("open");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("open");
}
sidebarToggleBtn.addEventListener("click", () => {
  sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
});
sidebarBackdrop.addEventListener("click", closeSidebar);

const views = {
  home: document.getElementById("home-view"),
  list: document.getElementById("list-view"),
  editor: document.getElementById("editor-view"),
  viewer: document.getElementById("viewer-view"),
  library: document.getElementById("library-view"),
};

// ── 캐릭터 라이브러리 (전역, 모든 기록에 공통 적용) ──
let libraryData = {}; // parseLibraryTable() 결과, renderLog에 넘겨줌

let libraryTableHtml = "";

async function loadLibrary() {
  const snap = await getDoc(doc(db, "settings", "library"));
  libraryTableHtml = snap.exists() ? snap.data().tableHtml || "" : "";
  const temp = document.createElement("div");
  temp.innerHTML = libraryTableHtml;
  libraryData = parseLibraryTable(temp);
  return libraryTableHtml;
}

// ── 인증 ──
loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    await signInShared(loginPassword.value);
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

onAuthStateChanged(auth, async (user) => {
  if (user) {
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    buildSidebar();
    await loadLibrary();
    router();
  } else {
    loginScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
  }
});

// ── 관리자 모드 ──
// 기록 추가/수정/라이브러리 저장은 관리자 모드에서만 할 수 있다. 관리자
// 여부는 별도의 관리자 계정(adminAuth) 세션이 실제로 로그인되어 있는지로
// 정해지고, 그 세션으로 로그인되어 있어야 Firestore 쓰기가 통과하므로
// (규칙이 관리자 이메일에게만 write를 허용) 아래 UI 상태를 흉내내는
// 것만으로는 저장이 되지 않는다. 브라우저에 저장되어 새로고침해도 유지된다.
let isAdmin = false;

// 뷰어 화면의 "수정" 링크처럼 나중에 동적으로 생기는 요소도 있어서, 캐싱하지
// 않고 매번 다시 조회한다.
function applyAdminUI() {
  sidebarAdminBadge.classList.toggle("hidden", !isAdmin);
  document.querySelectorAll("[data-admin-only]").forEach((el) => el.classList.toggle("hidden", !isAdmin));
}

onAuthStateChanged(adminAuth, (user) => {
  isAdmin = !!user;
  applyAdminUI();
});

const adminPasswordModal = document.getElementById("admin-password-modal");
const adminPasswordInput = document.getElementById("admin-password-input");
const adminPasswordError = document.getElementById("admin-password-error");
const adminPasswordSubmitBtn = document.getElementById("admin-password-submit-btn");

function openAdminPasswordModal() {
  adminPasswordInput.value = "";
  adminPasswordError.textContent = "";
  adminPasswordModal.classList.remove("hidden");
  adminPasswordInput.focus();
}

function closeAdminPasswordModal() {
  adminPasswordModal.classList.add("hidden");
}

async function trySubmitAdminPassword() {
  const password = adminPasswordInput.value;
  if (!password) return;
  adminPasswordSubmitBtn.disabled = true;
  adminPasswordError.textContent = "";
  try {
    await verifyAdminPassword(password);
    closeAdminPasswordModal();
  } catch (e) {
    console.error("관리자 로그인 실패:", e.code, e.message);
    adminPasswordError.textContent = "비밀번호가 올바르지 않습니다. (" + e.code + ")";
  } finally {
    adminPasswordSubmitBtn.disabled = false;
  }
}

sidebarModeBtn.addEventListener("click", () => {
  if (isAdmin) {
    logoutAdmin();
  } else {
    openAdminPasswordModal();
  }
});

document.getElementById("admin-password-cancel-btn").addEventListener("click", closeAdminPasswordModal);
adminPasswordSubmitBtn.addEventListener("click", trySubmitAdminPassword);
adminPasswordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") trySubmitAdminPassword();
});

// 관리자 모드에서는 먼저 뷰어 모드로만 내려가고, 뷰어 모드에서 한 번 더
// 눌러야 실제로 로그인 화면까지 나간다.
sidebarLogoutBtn.addEventListener("click", () => {
  if (isAdmin) {
    logoutAdmin();
  } else {
    logoutAll();
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
    header.innerHTML = `<img class="cat-icon icon-${cat.id}" src="${cat.icon}" alt="" /><span class="cat-label">${cat.label}</span><svg class="cat-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>`;

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
        closeSidebar();
      });
      subList.appendChild(item);
    });

    header.addEventListener("click", () => {
      subList.classList.toggle("open");
      header.querySelector(".cat-chevron").classList.toggle("open", subList.classList.contains("open"));
    });

    group.appendChild(header);
    group.appendChild(subList);
    categoryNav.appendChild(group);
  });
}

document.querySelector('.site-title').addEventListener('click', () => {
  location.hash = '#/home';
  closeSidebar();
});

document.getElementById('library-nav-btn').addEventListener('click', () => {
  location.hash = '#/library';
  closeSidebar();
});

// ── 라우팅 ──
function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  document.body.classList.toggle("home-bg-active", name === "home");
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
  } else if (route === "library") {
    showView("library");
    renderLibraryView();
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
  viewerBreadcrumb.innerHTML = `${cat?.label ?? data.category} &gt; ${sub?.label ?? data.subcategory} &nbsp;·&nbsp; <a href="#/edit/${recordId}" data-admin-only class="hidden">수정</a>`;
  applyAdminUI();
  viewerTitle.textContent = data.title || "(제목 없음)";
  viewerContent.innerHTML = data.tableHtml || "";
  // 프로필 사진은 톡 보관함 기록에서만 보여준다.
  renderLog(viewerContent, libraryData, { showAvatars: data.category === "talk" });
}

// ── 실행취소/다시실행 (Ctrl+Z / Ctrl+Y·Ctrl+Shift+Z) ──
// 표 삽입/행 추가/HTML 붙여넣기 등 버튼으로 하는 조작은 직접 DOM을 바꾸는 방식이라
// 브라우저 기본 실행취소 기록에 안 쌓여서, 타이핑 삭제만 취소되고 버튼으로 추가한
// 내용은 안 지워지는 문제가 있었음. MutationObserver로 모든 변경(타이핑 포함)을
// 감지해서 직접 undo/redo 스택을 관리하는 방식으로 교체.
function setupUndoRedo(el) {
  const undoStack = [];
  let redoStack = [];
  let debounceTimer = null;
  let applying = false;

  const snapshot = () => el.innerHTML;

  function commit() {
    if (applying) return;
    const current = snapshot();
    if (undoStack.length && undoStack[undoStack.length - 1] === current) return;
    undoStack.push(current);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }

  function apply(html) {
    applying = true;
    el.innerHTML = html;
    // MutationObserver 콜백은 마이크로태스크로 지연 실행되므로, applying을
    // 동기적으로 바로 내리면 관찰자 콜백이 그 이후(=false 상태)에 실행돼
    // 우리가 되돌린 변경을 새 변경으로 다시 스택에 쌓아버린다. 관찰자 콜백보다
    // 뒤에 실행되도록 마이크로태스크로 한 틱 늦춰서 해제한다.
    queueMicrotask(() => {
      applying = false;
    });
  }

  const observer = new MutationObserver(() => {
    if (applying) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(commit, 400);
  });
  observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });

  el.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (!mod) return;

    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      clearTimeout(debounceTimer);
      commit(); // 되돌리기 직전, 아직 안 쌓인 변경사항이 있으면 먼저 확정
      if (undoStack.length > 1) {
        const current = undoStack.pop();
        redoStack.push(current);
        apply(undoStack[undoStack.length - 1]);
      }
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      if (redoStack.length) {
        const next = redoStack.pop();
        undoStack.push(next);
        apply(next);
      }
    }
  });

  return {
    reset() {
      clearTimeout(debounceTimer);
      undoStack.length = 0;
      undoStack.push(snapshot());
      redoStack = [];
    },
  };
}

// ── 에디터 화면 ──
const recordTitleInput = document.getElementById("record-title");
const recordCategorySelect = document.getElementById("record-category");
const recordSubcategorySelect = document.getElementById("record-subcategory");
const editorContent = document.getElementById("editor-content");
const editorBreadcrumb = document.getElementById("editor-breadcrumb");
const editorUndo = setupUndoRedo(editorContent);

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
  editorUndo.reset();
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

// 대화 표 삽입
document.getElementById("btn-insert-table").addEventListener("click", () => {
  editorContent.focus();
  const html = `<table><tbody><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>`;
  document.execCommand("insertHTML", false, html);
});

function lastTable() {
  const tables = editorContent.querySelectorAll("table");
  return tables.length ? tables[tables.length - 1] : null;
}

// 현재 커서가 놓여 있는 <tr>을 찾는다 (표 밖이면 null)
function getCursorRow() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!node || !node.closest) return null;
  const tr = node.closest("tr");
  if (tr && editorContent.contains(tr)) return tr;
  return null;
}

// 표 안에서 커서가 놓인 <td>를 찾는다 (표 밖이면 null). 에디터/라이브러리 둘 다에서 씀.
function getCursorCell(container) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!node || !node.closest) return null;
  const td = node.closest("td");
  if (td && container.contains(td)) return td;
  return null;
}

function placeCursorInCell(cell) {
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// 표 안에서 위/아래 방향키를 누르면 같은 열의 위/아랫줄로 바로 이동한다.
// (기본 동작은 줄 안의 옆 칸을 먼저 거쳐가서, 그걸 막고 세로 이동만 하게 함)
function handleTableVerticalNav(e, container) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const cell = getCursorCell(container);
  if (!cell) return;
  const row = cell.parentElement;
  const cellIndex = Array.prototype.indexOf.call(row.children, cell);
  const targetRow = e.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
  if (!targetRow) return;
  const targetCell = targetRow.children[cellIndex] || targetRow.children[targetRow.children.length - 1];
  if (!targetCell) return;
  e.preventDefault();
  placeCursorInCell(targetCell);
}

editorContent.addEventListener("keydown", (e) => handleTableVerticalNav(e, editorContent));

function makeBlankRow() {
  const tr = document.createElement("tr");
  const td1 = document.createElement("td");
  td1.innerHTML = "<br>";
  const td2 = document.createElement("td");
  td2.innerHTML = "<br>";
  tr.appendChild(td1);
  tr.appendChild(td2);
  return tr;
}

// 행 추가: 몇 줄을 추가할지 물어보고, 커서가 있는 행 바로 아래에 삽입
document.getElementById("btn-add-row").addEventListener("click", () => {
  const countStr = prompt("몇 줄을 추가할까요?", "1");
  if (countStr === null) return;
  const count = parseInt(countStr, 10);
  if (!count || count < 1) return;

  let insertAfter = getCursorRow();
  if (!insertAfter) {
    const table = lastTable();
    if (!table) {
      alert("먼저 '대화 표 삽입'으로 표를 만들어주세요.");
      return;
    }
    const rows = table.querySelectorAll("tr");
    insertAfter = rows[rows.length - 1];
  }

  for (let i = 0; i < count; i++) {
    const tr = makeBlankRow();
    insertAfter.insertAdjacentElement("afterend", tr);
    insertAfter = tr;
  }
});

// 접기 / 접기 끝 / 표 유지: 새 행을 만들지 않고, 커서가 있는 행의 첫 칸(이름 칸)에 문구를 추가
document.querySelectorAll("#editor-toolbar button[data-quick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tr = getCursorRow();
    if (!tr) {
      alert("커서를 표 안의 칸에 놓아주세요.");
      return;
    }
    const firstTd = tr.querySelector("td");
    if (!firstTd) return;
    firstTd.textContent = firstTd.textContent.trim() + btn.dataset.quick;
  });
});

// HTML 붙여넣기 (기존 티스토리 표 HTML을 그대로 붙여넣는 기능)
// 기록 에디터/라이브러리 에디터 둘 다에서 쓰므로, 열 때 대상(pasteTarget)을 지정해둔다.
const pasteModal = document.getElementById("paste-modal");
const pasteTextarea = document.getElementById("paste-textarea");
let pasteTarget = null;

function openPasteModal(targetEl) {
  pasteTarget = targetEl;
  pasteTextarea.value = "";
  pasteModal.classList.remove("hidden");
}

document.getElementById("btn-paste-html").addEventListener("click", () => {
  openPasteModal(editorContent);
});
document.getElementById("paste-cancel-btn").addEventListener("click", () => {
  pasteModal.classList.add("hidden");
});
document.getElementById("paste-confirm-btn").addEventListener("click", () => {
  if (pasteTarget) pasteTarget.insertAdjacentHTML("beforeend", pasteTextarea.value);
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

  try {
    if (editingRecordId) {
      await updateDoc(doc(adminDb, "records", editingRecordId), {
        title,
        category,
        subcategory,
        tableHtml,
        updatedAt: serverTimestamp(),
      });
      location.hash = `#/view/${editingRecordId}`;
    } else {
      const newDoc = await addDoc(collection(adminDb, "records"), {
        title,
        category,
        subcategory,
        tableHtml,
        authorUid: adminAuth.currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      location.hash = `#/view/${newDoc.id}`;
    }
  } catch (e) {
    console.error("저장 실패:", e.code, e.message);
    alert("저장에 실패했습니다: " + (e.code || e.message));
  }
});

// ── 캐릭터 라이브러리 관리 화면 ──
const libraryContent = document.getElementById("library-content");
libraryContent.addEventListener("keydown", (e) => handleTableVerticalNav(e, libraryContent));
const libraryUndo = setupUndoRedo(libraryContent);

function renderLibraryView() {
  libraryContent.innerHTML = libraryTableHtml;
  libraryUndo.reset();
}

const LIBRARY_MIN_COLUMNS = 10;

document.getElementById("btn-library-insert-table").addEventListener("click", () => {
  if (libraryContent.querySelector("table")) {
    alert("이미 표가 있습니다. '캐릭터 칸 추가'로 인원을 늘려주세요.");
    return;
  }
  const nameCells = Array.from({ length: LIBRARY_MIN_COLUMNS }, () => "<td><br></td>").join("");
  const imgCells = Array.from({ length: LIBRARY_MIN_COLUMNS }, () => "<td><br></td>").join("");
  libraryContent.innerHTML = `<table><tbody><tr>${nameCells}</tr><tr>${imgCells}</tr></tbody></table>`;
});

document.getElementById("btn-library-add-character").addEventListener("click", () => {
  const table = libraryContent.querySelector("table");
  if (!table) {
    alert("먼저 '라이브러리 표 삽입'으로 표를 만들어주세요.");
    return;
  }
  const rows = table.querySelectorAll("tr");
  if (rows.length < 2) return;
  const nameTd = document.createElement("td");
  nameTd.innerHTML = "<br>";
  rows[0].appendChild(nameTd);
  const imgTd = document.createElement("td");
  imgTd.innerHTML = "<br>";
  rows[1].appendChild(imgTd);
});

document.getElementById("btn-library-paste-html").addEventListener("click", () => {
  openPasteModal(libraryContent);
});

// 이미지 추가: 커서가 놓인 칸(td)에 이미지 링크(URL)를 넣는다.
document.getElementById("btn-library-insert-image").addEventListener("click", () => {
  const targetCell = getCursorCell(libraryContent);
  if (!targetCell) {
    alert("이미지를 넣을 칸(사진 칸)에 커서를 놓고 눌러주세요.");
    return;
  }
  const url = prompt("이미지 URL을 입력하세요:");
  if (!url) return;
  targetCell.innerHTML = `<img src="${url}" />`;
});

document.getElementById("save-library-btn").addEventListener("click", async () => {
  const newTableHtml = libraryContent.innerHTML;
  try {
    await setDoc(doc(adminDb, "settings", "library"), {
      tableHtml: newTableHtml,
      updatedAt: serverTimestamp(),
    });
    libraryTableHtml = newTableHtml;
    const temp = document.createElement("div");
    temp.innerHTML = libraryTableHtml;
    libraryData = parseLibraryTable(temp);
    alert("저장되었습니다.");
  } catch (e) {
    console.error("라이브러리 저장 실패:", e.code, e.message);
    alert("저장에 실패했습니다: " + (e.code || e.message));
  }
});
