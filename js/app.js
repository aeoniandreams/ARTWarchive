import {
  auth,
  db,
  adminAuth,
  adminDb,
  signInShared,
  verifyAdminPassword,
  logoutAdmin,
  logoutAll,
} from "./firebase-config.js?v=72";
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
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { CATEGORIES, findCategory, findSubcategory } from "./categories.js?v=72";
import { renderLog, parseLibraryTable, resizeContentImages } from "./render-log.js?v=72";

// ── DOM refs ──
const loadingView = document.getElementById("loading-view");
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

document.getElementById("list-logo").addEventListener("click", () => {
  location.hash = "#/home";
});

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

// 로딩 화면이 최소 1초는 보이도록 — 너무 빨리 끝나면 이미지 애니메이션이
// 한 프레임 반짝이고 사라지는 것처럼 보인다.
const MIN_LOADING_MS = 1000;

onAuthStateChanged(auth, async (user) => {
  const elapsed = Date.now() - (window.__pageLoadStart || Date.now());
  const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  loadingView.classList.add("hidden");

  if (user) {
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    buildSidebar();
    await loadLibrary();
    // 이전 세션에서 리스트/에디터 등에 있다가 새로고침했거나, 로그아웃 후
    // 다시 로그인했을 때 그 화면이 남아있지 않도록 항상 홈부터 보여준다.
    location.hash = "#/home";
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
  document.body.classList.toggle("is-admin", isAdmin);
  if (listSortableInstance) listSortableInstance.option("disabled", !isAdmin);
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
      const willOpen = !subList.classList.contains("open");
      // 한 번에 하나의 1차 카테고리만 펼쳐지도록, 열기 전에 다른 카테고리는 다 닫는다.
      categoryNav.querySelectorAll(".subcat-list.open").forEach((el) => el.classList.remove("open"));
      categoryNav.querySelectorAll(".cat-chevron.open").forEach((el) => el.classList.remove("open"));
      if (willOpen) {
        subList.classList.add("open");
        header.querySelector(".cat-chevron").classList.add("open");
      }
    });

    group.appendChild(header);
    group.appendChild(subList);
    categoryNav.appendChild(group);
  });
}

document.getElementById('library-nav-btn').addEventListener('click', () => {
  location.hash = '#/library';
  closeSidebar();
});

// ── 라우팅 ──
const LIST_BG_CLASSES = ["list-bg-main_story", "list-bg-call", "list-bg-talk", "list-bg-diary"];
// 뷰어(개별 기록 화면)에서 리스트보다 더 흐리게 보여줄 카테고리는 여기서 별도 클래스로 덮어쓴다.
const VIEWER_BG_CLASS_MAP = { main_story: "viewer-bg-main_story" };
const ALL_BG_CLASSES = [...LIST_BG_CLASSES, ...Object.values(VIEWER_BG_CLASS_MAP)];

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  document.body.classList.toggle("home-bg-active", name === "home");
  document.body.classList.toggle("library-bg-active", name === "library");
  if (name !== "list" && name !== "viewer") {
    document.body.classList.remove(...ALL_BG_CLASSES);
  }
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

// 카테고리별로 "아직 기록이 없습니다" 빈 상태에 보여줄 아이콘 (lucide-static).
const EMPTY_STATE_ICONS = {
  call: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 2 6 6" /><path d="m22 2-6 6" /><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" /></svg>',
  talk: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /><path d="M12 11h.01" /><path d="M16 11h.01" /><path d="M8 11h.01" /></svg>',
  diary: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17h1.5" /><path d="M12 22h1.5" /><path d="M12 2h1.5" /><path d="M17.5 22H19a1 1 0 0 0 1-1" /><path d="M17.5 2H19a1 1 0 0 1 1 1v1.5" /><path d="M20 14v3h-2.5" /><path d="M20 8.5V10" /><path d="M4 10V8.5" /><path d="M4 19.5V14" /><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H8" /><path d="M8 22H6.5a1 1 0 0 1 0-5H8" /></svg>',
  main_story: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="m9.5 17 5-5" /><path d="m9.5 12 5 5" /></svg>',
};

function emptyStateHtml(catId) {
  const icon = EMPTY_STATE_ICONS[catId] || "";
  return `<li class="empty-state"><span class="empty-state-icon">${icon}</span>아직 기록이 없습니다.</li>`;
}

// breadcrumb에서 카테고리 > 하위 카테고리 사이 구분자로 쓰는 chevron-right (lucide).
const BREADCRUMB_CHEVRON = '<svg class="breadcrumb-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>';

// 커스텀 순서(order)가 있으면 그걸 우선으로 정렬하고, 없는 기록들은 원래 쿼리
// 순서(최신순)를 그대로 유지한 채 뒤로 보낸다. Array.sort는 안정 정렬이라 order가
// 같은(혹은 둘 다 없는) 항목끼리는 원래 순서가 그대로 유지된다. 리스트 화면과
// 뷰어의 이전/다음 글 이동이 항상 같은 기준을 쓰도록 여기 한 곳에만 둔다.
function sortRecordsByOrder(records) {
  records.sort((a, b) => {
    const ao = typeof a.order === "number" ? a.order : null;
    const bo = typeof b.order === "number" ? b.order : null;
    if (ao !== null && bo !== null) return ao - bo;
    if (ao !== null) return -1;
    if (bo !== null) return 1;
    return 0;
  });
  return records;
}

// 특정 카테고리/서브카테고리의 기록을, 리스트 화면과 동일한 정렬 기준으로 가져온다.
async function fetchSortedRecords(catId, subId) {
  const q = query(
    collection(db, "records"),
    where("category", "==", catId),
    where("subcategory", "==", subId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  const records = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  return sortRecordsByOrder(records);
}

// ── 리스트 화면 ──
async function renderListView(catId, subId) {
  const cat = findCategory(catId);
  const sub = findSubcategory(catId, subId);
  document.getElementById("list-breadcrumb").innerHTML = `${cat?.label ?? catId}${BREADCRUMB_CHEVRON}${sub?.label ?? subId}`;

  document.body.classList.remove(...ALL_BG_CLASSES);
  if (LIST_BG_CLASSES.includes(`list-bg-${catId}`)) {
    document.body.classList.add(`list-bg-${catId}`);
  }

  document.getElementById("new-record-btn").onclick = () => {
    location.hash = `#/new/${catId}/${subId}`;
  };

  const listEl = document.getElementById("record-list");
  listEl.innerHTML = "<li class='empty-state'>불러오는 중...</li>";

  let records;
  try {
    records = await fetchSortedRecords(catId, subId);
  } catch (e) {
    console.error("리스트 조회 실패:", e.code, e.message);
    listEl.innerHTML = `<li class='empty-state'>목록을 불러오지 못했습니다: ${e.code || e.message}<br>(Firestore에 복합 색인이 필요할 수 있어요 — 콘솔 오류 메시지의 링크를 확인해주세요)</li>`;
    return;
  }

  if (records.length === 0) {
    listEl.innerHTML = emptyStateHtml(catId);
    return;
  }

  listEl.innerHTML = "";
  records.forEach((data) => {
    const li = document.createElement("li");
    li.dataset.id = data.id;
    li.innerHTML = `<div class="record-title">${data.title || "(제목 없음)"}</div>`;
    li.addEventListener("click", () => {
      location.hash = `#/view/${data.id}`;
    });
    listEl.appendChild(li);
  });

  initListSortable();
}

// ── 리스트 드래그 정렬 ──
// 관리자 모드에서만 드래그로 순서를 바꿀 수 있고, 그 결과(order 필드)는
// 뷰어를 포함한 모두에게 동일하게 적용된다.
let listSortableInstance = null;

function initListSortable() {
  if (listSortableInstance) {
    listSortableInstance.destroy();
    listSortableInstance = null;
  }
  if (typeof Sortable === "undefined") return;
  const listEl = document.getElementById("record-list");
  listSortableInstance = Sortable.create(listEl, {
    animation: 150,
    disabled: !isAdmin,
    onEnd: async () => {
      const ids = Array.from(listEl.children)
        .map((li) => li.dataset.id)
        .filter(Boolean);
      const batch = writeBatch(adminDb);
      ids.forEach((id, index) => {
        batch.update(doc(adminDb, "records", id), { order: index });
      });
      try {
        await batch.commit();
      } catch (e) {
        console.error("순서 저장 실패:", e.code, e.message);
        alert("순서 저장에 실패했습니다: " + (e.code || e.message));
      }
    },
  });
}

// ── 뷰어 화면 ──
const viewerPrevBtn = document.getElementById("viewer-prev-btn");
const viewerNextBtn = document.getElementById("viewer-next-btn");

// 데스크탑에서 이전/다음 글 버튼이 항상 흰 박스(.viewer-card) 바로 양옆, 화면
// 세로 중앙에 오도록 위치를 잡는다. position: fixed라 스크롤해도 안 움직이고,
// 박스의 실제 렌더링 위치(사이드바 유무, 화면 너비에 따라 달라짐)는 JS로 재서
// left/right를 매번 맞춘다. 모바일(max-width:768px)에서는 CSS가 static으로
// 바꿔서 박스 밑에 나란히 놓으므로 이 계산이 필요 없다.
function positionViewerNavButtons() {
  // window.innerWidth는 세로 스크롤바 두께까지 포함하는데, 카드의 실제 위치
  // (getBoundingClientRect)는 스크롤바를 뺀 문서 영역 기준이라 그 차이만큼
  // 오른쪽 버튼만 카드에 더 붙어 보였다. document.documentElement.clientWidth는
  // 스크롤바를 뺀 값이라 카드 위치와 같은 기준으로 계산된다.
  const viewportWidth = document.documentElement.clientWidth;
  if (viewportWidth <= 768) return;
  const card = document.querySelector(".viewer-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const btnWidth = 44;
  // 카드 바깥, 화면 가장자리까지 남는 여백의 정중앙에 버튼을 놓는다.
  const leftSpace = rect.left;
  const rightSpace = viewportWidth - rect.right;
  viewerPrevBtn.style.left = `${Math.max(8, (leftSpace - btnWidth) / 2)}px`;
  viewerNextBtn.style.right = `${Math.max(8, (rightSpace - btnWidth) / 2)}px`;
}
window.addEventListener("resize", positionViewerNavButtons);

async function renderViewerView(recordId) {
  const viewerContent = document.getElementById("viewer-content");
  const viewerTitle = document.getElementById("viewer-title");
  const viewerBreadcrumb = document.getElementById("viewer-breadcrumb");
  viewerContent.innerHTML = "불러오는 중...";
  viewerPrevBtn.classList.add("hidden");
  viewerNextBtn.classList.add("hidden");

  const snap = await getDoc(doc(db, "records", recordId));
  if (!snap.exists()) {
    viewerContent.innerHTML = "기록을 찾을 수 없습니다.";
    return;
  }
  const data = snap.data();
  const cat = findCategory(data.category);
  const sub = findSubcategory(data.category, data.subcategory);

  document.body.classList.remove(...ALL_BG_CLASSES);
  if (VIEWER_BG_CLASS_MAP[data.category]) {
    document.body.classList.add(VIEWER_BG_CLASS_MAP[data.category]);
  } else if (LIST_BG_CLASSES.includes(`list-bg-${data.category}`)) {
    document.body.classList.add(`list-bg-${data.category}`);
  }

  viewerBreadcrumb.innerHTML = `<a href="#/list/${data.category}/${data.subcategory}" aria-label="목록으로">&larr;</a> &nbsp;·&nbsp; ${cat?.label ?? data.category}${BREADCRUMB_CHEVRON}${sub?.label ?? data.subcategory} &nbsp;·&nbsp; <a href="#/edit/${recordId}" data-admin-only class="hidden">수정</a>`;
  applyAdminUI();
  viewerTitle.textContent = data.title || "(제목 없음)";
  viewerContent.innerHTML = data.tableHtml || "";
  // 토글 제목 등 수정창에서만 필요했던 contenteditable 흔적은 읽기 전용 화면에서 지운다.
  viewerContent.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  // 에디터에서는 토글을 삽입하면 기본이 열림 상태라 그 상태 그대로 저장돼 있는데,
  // 뷰어에서는 매번 새로 열 때마다(뒤로가기 후 다시 들어와도) 닫힌 상태로 시작하게 한다.
  viewerContent.querySelectorAll(".editor-toggle.open").forEach((el) => el.classList.remove("open"));
  // 프로필 사진은 톡 보관함 기록에서만 보여준다.
  renderLog(viewerContent, libraryData, { showAvatars: data.category === "talk" });

  // 이전/다음 글: 리스트 화면과 동일한 정렬 기준으로 같은 카테고리/서브카테고리
  // 목록을 다시 가져와서, 지금 보고 있는 기록의 앞뒤를 찾는다. 리스트에서
  // 드래그로 순서를 바꿨다면 그 순서가 여기에도 그대로 반영된다.
  const siblings = await fetchSortedRecords(data.category, data.subcategory);
  const index = siblings.findIndex((r) => r.id === recordId);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  viewerPrevBtn.classList.toggle("hidden", !prev);
  viewerNextBtn.classList.toggle("hidden", !next);
  viewerPrevBtn.onclick = prev ? () => { location.hash = `#/view/${prev.id}`; } : null;
  viewerNextBtn.onclick = next ? () => { location.hash = `#/view/${next.id}`; } : null;
  positionViewerNavButtons();
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
  recordTitleInput.value = "";
  editorContent.innerHTML = "";

  if (recordId) {
    editorBreadcrumb.innerHTML = `<a href="#/view/${recordId}" aria-label="기록으로">&larr;</a> &nbsp;·&nbsp; 기록 수정`;
    const snap = await getDoc(doc(db, "records", recordId));
    if (snap.exists()) {
      const data = snap.data();
      recordTitleInput.value = data.title || "";
      recordCategorySelect.value = data.category;
      fillSubcategorySelect(data.category, data.subcategory);
      editorContent.innerHTML = data.tableHtml || "";
    }
  } else {
    editorBreadcrumb.innerHTML = `<a href="#/list/${categoryId}/${subcategoryId}" aria-label="목록으로">&larr;</a> &nbsp;·&nbsp; 새 기록 추가`;
    recordCategorySelect.value = categoryId;
    fillSubcategorySelect(categoryId, subcategoryId);
  }
  editorUndo.reset();
}

// 서식 버튼 (굵게/기울임)
document.querySelectorAll("#editor-toolbar button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => {
    ensureEditorFocus();
    document.execCommand(btn.dataset.cmd, false, null);
  });
});

document.getElementById("color-picker").addEventListener("input", (e) => {
  ensureEditorFocus();
  document.execCommand("foreColor", false, e.target.value);
});

// 대화 표 삽입
document.getElementById("btn-insert-table").addEventListener("click", () => {
  ensureEditorFocus();
  const html = `<table><tbody><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>`;
  document.execCommand("insertHTML", false, html);
});

// 토글 삽입: 접었다 펼 수 있는 구획. 제목은 커스텀 가능하고 안에 표를 포함해
// 기존 툴바 기능을 그대로 쓸 수 있다. 표 안의 /접기·/끝(행 단위로 파싱되는
// 대화 접기)과는 완전히 별개 — 이쪽은 DOM 레벨의 구획이라 표를 통째로 여러 개
// 넣을 수도 있다. 수정창과 뷰어 양쪽 다 같은 클래스/CSS를 쓰기 때문에 저장된
// 뒤에도 독자가 직접 열고 닫을 수 있다.
document.getElementById("btn-insert-toggle").addEventListener("click", () => {
  ensureEditorFocus();
  const html = `<div class="editor-toggle open" contenteditable="false"><div class="editor-toggle-header"><svg class="editor-toggle-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg><span class="editor-toggle-title" contenteditable="true">토글 제목</span></div><div class="editor-toggle-body" contenteditable="true"><p><br></p></div></div><p><br></p>`;
  document.execCommand("insertHTML", false, html);
});

// 토글 헤더 클릭 시 열림/닫힘 전환 (제목 텍스트 자체를 클릭한 경우는 편집을 위해 제외).
// 수정창·뷰어 둘 다에서 동작해야 해서 #main-area에 위임해뒀다 — 뷰어 내용은
// innerHTML로 통째로 갈아끼워지기 때문에, 요소별로 직접 리스너를 달면 매번
// 다시 달아야 한다.
document.getElementById("main-area").addEventListener("click", (e) => {
  const header = e.target.closest(".editor-toggle-header");
  if (!header) return;
  if (e.target.closest(".editor-toggle-title")) return;
  const toggle = header.closest(".editor-toggle");
  toggle.classList.toggle("open");
  if (toggle.classList.contains("open")) {
    // 접혀있던 동안 크기 계산이 안 된 이미지가 있을 수 있어 다시 계산한다.
    setTimeout(() => resizeContentImages(toggle), 50);
  }
});

function lastTable() {
  const tables = editorContent.querySelectorAll("table");
  return tables.length ? tables[tables.length - 1] : null;
}

// 토글 안(.editor-toggle-body)은 contenteditable=false로 감싼 안쪽에 다시
// contenteditable=true를 둔 중첩 구조라, 브라우저가 그 부분을 #editor-content와는
// 별개의 편집 영역(activeElement)으로 취급한다. 이 상태에서 무조건
// editorContent.focus()를 부르면 포커스가 바깥으로 튕겨나가면서 토글 안에
// 있던 커서 위치(선택 영역)가 사라져, 이후 execCommand가 토글 밖에 삽입되거나
// 아예 실패한다. 커서가 이미 에디터(토글 내부 포함) 안에 있으면 그대로 두고,
// 정말 포커스가 벗어나 있을 때만 focus()를 부른다.
function ensureEditorFocus() {
  const sel = window.getSelection();
  if (sel.rangeCount > 0 && editorContent.contains(sel.getRangeAt(0).startContainer)) {
    return;
  }
  editorContent.focus();
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
// 모달을 열고 텍스트영역에 HTML을 입력하는 동안 브라우저 선택 영역은 그
// 텍스트영역으로 옮겨가버려서, 확인 버튼을 눌렀을 때는 에디터 안 커서가
// 어디 있었는지 알 수 없다. 그래서 모달을 여는 시점(포커스가 옮겨가기 전)의
// 커서 위치를 Range로 저장해뒀다가, 확인 시 그 자리에 그대로 복원해서 넣는다.
let pasteSavedRange = null;

function openPasteModal(targetEl) {
  pasteTarget = targetEl;
  const sel = window.getSelection();
  pasteSavedRange =
    sel.rangeCount > 0 && targetEl.contains(sel.getRangeAt(0).startContainer)
      ? sel.getRangeAt(0).cloneRange()
      : null;
  pasteTextarea.value = "";
  pasteModal.classList.remove("hidden");
}

// 저장해둔 Range를 복원하면서, 그 Range가 속한 가장 안쪽의 편집 가능 영역(토글
// 본문처럼 중첩된 contenteditable일 수도 있음)에 포커스를 준다. 포커스를 먼저 주고
// 그 다음에 선택 영역을 지정해야, focus()가 선택 영역을 건드려도 최종적으로는
// 우리가 원하는 위치가 커서로 남는다.
function restoreRangeAndFocus(range, fallbackTarget) {
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const editable = (node && node.closest && node.closest('[contenteditable="true"]')) || fallbackTarget;
  if (editable) editable.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// 기록 에디터에서는 글자 배경색(하이라이트)을 못 넣게 막는다 — 글자 '색'은 그대로 두고
// background-color/background만 지운다. td나 표 자체의 배경도 걸러지지만, 어차피
// render-log.js는 칸의 내용(innerHTML)만 복사하고 칸 자체의 style은 가져가지 않아서
// 실제로 화면에 영향을 주는 건 글자를 감싼 span 등의 배경뿐이다.
function stripBackgroundColors(root) {
  root.querySelectorAll("[style]").forEach((el) => {
    el.style.removeProperty("background-color");
    el.style.removeProperty("background");
    if (!el.getAttribute("style")) el.removeAttribute("style");
  });
  root.querySelectorAll("[bgcolor]").forEach((el) => el.removeAttribute("bgcolor"));
}

// 모달을 거치지 않고 Ctrl+V로 직접 붙여넣는 경우도 막는다.
editorContent.addEventListener("paste", (e) => {
  const html = e.clipboardData && e.clipboardData.getData("text/html");
  if (!html) return;
  e.preventDefault();
  const temp = document.createElement("div");
  temp.innerHTML = html;
  stripBackgroundColors(temp);
  document.execCommand("insertHTML", false, temp.innerHTML);
});

document.getElementById("btn-paste-html").addEventListener("click", () => {
  openPasteModal(editorContent);
});
document.getElementById("paste-cancel-btn").addEventListener("click", () => {
  pasteModal.classList.add("hidden");
});
document.getElementById("paste-confirm-btn").addEventListener("click", () => {
  if (pasteTarget) {
    let html = pasteTextarea.value;
    if (pasteTarget === editorContent) {
      const temp = document.createElement("div");
      temp.innerHTML = html;
      stripBackgroundColors(temp);
      html = temp.innerHTML;
    }
    if (pasteSavedRange) {
      restoreRangeAndFocus(pasteSavedRange, pasteTarget);
    } else {
      pasteTarget.focus();
      const range = document.createRange();
      range.selectNodeContents(pasteTarget);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand("insertHTML", false, html);
  }
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
