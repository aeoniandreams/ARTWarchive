import {
  auth,
  db,
  adminAuth,
  adminDb,
  signInShared,
  verifyAdminPassword,
  logoutAdmin,
  logoutAll,
} from "./firebase-config.js?v=269";
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
  deleteDoc,
  deleteField,
  Bytes,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { CATEGORIES, CHARACTERS, findCategory, findSubcategory } from "./categories.js?v=269";
import { renderLog, parseLibraryTable, resizeContentImages } from "./render-log.js?v=269";

// 톡 보관함 하위 카테고리별로 리스트 필터/에디터 드롭다운의 선택지가 다르다.
// 따로 지정 안 한 하위 카테고리(일별 톡, 프리미엄 톡)는 인물 6명이 기본값.
// 시즌 톡은 이 드롭다운 자체가 안 보이니 여기서 신경 안 써도 된다.
const DEFAULT_TALK_FILTER_OPTIONS = CHARACTERS.map((ch) => ({ value: ch.id, label: ch.label }));
const SUBCATEGORY_FILTER_OPTIONS = {
  other_condition: [
    { value: "summoner_levelup", label: "소환사 레벨업" },
    { value: "story_view", label: "스토리 열람" },
  ],
  favor: [...DEFAULT_TALK_FILTER_OPTIONS, { value: "revenge", label: "복수 달성" }],
};
function getTalkFilterOptions(subId) {
  return SUBCATEGORY_FILTER_OPTIONS[subId] || DEFAULT_TALK_FILTER_OPTIONS;
}

// 다이어리는 하위 카테고리(인물)와 무관하게 전부 같은 두 가지 선택지를 쓴다.
const DIARY_FILTER_OPTIONS = [
  { value: "wizard_card", label: "마법사 카드" },
  { value: "wish_card", label: "소원 카드" },
];
// 보이스도 하위 카테고리(인물)와 무관하게 전부 같은 네 가지 선택지를 쓴다.
const VOICE_FILTER_OPTIONS = [
  { value: "home", label: "홈 화면" },
  { value: "closet", label: "옷장" },
  { value: "surprise_summon", label: "깜짝 소환" },
  { value: "battle", label: "전투" },
];
function getFilterOptions(catId, subId) {
  if (catId === "diary") return DIARY_FILTER_OPTIONS;
  if (catId === "voice") return VOICE_FILTER_OPTIONS;
  return getTalkFilterOptions(subId);
}
// 리스트 필터/에디터의 이 드롭다운(character 필드)이 있는 카테고리인지.
// 톡 보관함은 시즌 톡만 빠진다.
function categoryHasFilter(catId, subId) {
  return (catId === "talk" && subId !== "season") || catId === "diary" || catId === "voice";
}

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
  // 다음에 다시 열었을 때 항상 다 접힌 상태로 보이도록, 닫히는 김에 펼쳐진
  // 2차 카테고리도 초기화한다. 어차피 서랍째로 화면 밖으로 밀려나가는 중이라
  // 애니메이션 없이 바로 접어도 눈에 띄지 않는다.
  categoryNav.querySelectorAll(".subcat-list.open").forEach((el) => {
    el.classList.remove("open");
    el.style.maxHeight = "0px";
  });
  categoryNav.querySelectorAll(".cat-chevron.open").forEach((el) => el.classList.remove("open"));
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
  chatrooms: document.getElementById("chatrooms-view"),
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
    } else if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential" || e.code === "auth/wrong-password") {
      loginError.textContent = "잘못된 비밀번호입니다.";
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
    // adminAuth의 onAuthStateChanged가 이 콜백보다 먼저 끝나버리면, 그때는
    // 아직 설정 카테고리(동적으로 생성됨)가 DOM에 없어서 admin-only 토글이
    // 먹히지 않는다. buildSidebar 직후 한 번 더 돌려서, 이미 로그인된
    // 관리자 세션이면 방금 만든 설정 카테고리도 바로 보이게 한다.
    applyAdminUI();
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
  if (listSortableInstance) listSortableInstance.option("disabled", !isAdmin || !isDesktopViewport());
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
// 2차 카테고리 목록(.subcat-list)도 다른 곳들처럼 max-height 트랜지션으로
// 열고 닫는다 — display:none/block은 트랜지션이 안 걸려서 뚝 나타나 보인다.
function openSubcatList(el) {
  el.classList.add("open");
  el.style.maxHeight = el.scrollHeight + "px";
}
function closeSubcatList(el) {
  el.style.maxHeight = el.scrollHeight + "px";
  void el.offsetHeight;
  el.style.maxHeight = "0px";
  el.classList.remove("open");
}

// 1차 카테고리 하나(아이콘+라벨+펼침 화살표)와 그 안의 2차 카테고리 목록을
// 만든다. CATEGORIES 기반의 일반 카테고리와, 아래의 관리자 전용 "설정"
// 카테고리가 이 함수를 같이 쓴다.
function buildCatGroup({ iconHtml, label, items, adminOnly, extraClass }) {
  const group = document.createElement("div");
  group.className = adminOnly ? "cat-group hidden" : "cat-group";
  if (extraClass) group.classList.add(extraClass);
  if (adminOnly) group.setAttribute("data-admin-only", "");

  const header = document.createElement("div");
  header.className = "cat-header";
  header.innerHTML = `${iconHtml}<span class="cat-label">${label}</span><svg class="cat-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>`;

  const subList = document.createElement("div");
  subList.className = "subcat-list";
  items.forEach(({ id, label: itemLabel, onClick }) => {
    const item = document.createElement("div");
    item.className = "subcat-item";
    item.textContent = itemLabel;
    if (id) item.id = id;
    item.addEventListener("click", onClick);
    subList.appendChild(item);
  });

  header.addEventListener("click", () => {
    const willOpen = !subList.classList.contains("open");
    // 한 번에 하나의 1차 카테고리만 펼쳐지도록, 열기 전에 다른 카테고리는 다 닫는다.
    categoryNav.querySelectorAll(".subcat-list.open").forEach((el) => closeSubcatList(el));
    categoryNav.querySelectorAll(".cat-chevron.open").forEach((el) => el.classList.remove("open"));
    if (willOpen) {
      openSubcatList(subList);
      header.querySelector(".cat-chevron").classList.add("open");
    }
  });

  group.appendChild(header);
  group.appendChild(subList);
  categoryNav.appendChild(group);
}

function buildSidebar() {
  categoryNav.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    buildCatGroup({
      iconHtml: `<img class="cat-icon icon-${cat.id}" src="${cat.icon}" alt="" />`,
      label: cat.label,
      items: cat.subcategories.map((sub) => ({
        label: sub.label,
        onClick: () => {
          location.hash = `#/list/${cat.id}/${sub.id}`;
          closeSidebar();
        },
      })),
    });
  });

  // 설정(관리자 전용): 라이브러리 관리 · 채팅방 참여자 관리
  buildCatGroup({
    iconHtml:
      '<svg class="cat-icon icon-settings" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><defs><linearGradient id="settings-gear-grad" gradientUnits="userSpaceOnUse" x1="0" y1="1" x2="0" y2="23"><stop offset="0" stop-color="#543ab8"/><stop offset="0.4" stop-color="#3a267a"/><stop offset="1" stop-color="#1c1d39"/></linearGradient></defs><path d="M9.84 4.71 L9.92 2.22 A10.0 10.0 0 0 1 14.08 2.22 L14.16 4.71 A7.6 7.6 0 0 1 15.63 5.32 L15.63 5.32 L17.45 3.61 A10.0 10.0 0 0 1 20.39 6.55 L18.68 8.37 A7.6 7.6 0 0 1 19.29 9.84 L19.29 9.84 L21.78 9.92 A10.0 10.0 0 0 1 21.78 14.08 L19.29 14.16 A7.6 7.6 0 0 1 18.68 15.63 L18.68 15.63 L20.39 17.45 A10.0 10.0 0 0 1 17.45 20.39 L15.63 18.68 A7.6 7.6 0 0 1 14.16 19.29 L14.16 19.29 L14.08 21.78 A10.0 10.0 0 0 1 9.92 21.78 L9.84 19.29 A7.6 7.6 0 0 1 8.37 18.68 L8.37 18.68 L6.55 20.39 A10.0 10.0 0 0 1 3.61 17.45 L5.32 15.63 A7.6 7.6 0 0 1 4.71 14.16 L4.71 14.16 L2.22 14.08 A10.0 10.0 0 0 1 2.22 9.92 L4.71 9.84 A7.6 7.6 0 0 1 5.32 8.37 L5.32 8.37 L3.61 6.55 A10.0 10.0 0 0 1 6.55 3.61 L8.37 5.32 A7.6 7.6 0 0 1 9.84 4.71 Z M7.50 12 a4.50 4.50 0 1 0 9.00 0 a4.50 4.50 0 1 0 -9.00 0 Z" fill="url(#settings-gear-grad)" fill-rule="evenodd"/><path d="M9.84 4.71 L9.92 2.22 A10.0 10.0 0 0 1 14.08 2.22 L14.16 4.71 A7.6 7.6 0 0 1 15.63 5.32 L15.63 5.32 L17.45 3.61 A10.0 10.0 0 0 1 20.39 6.55 L18.68 8.37 A7.6 7.6 0 0 1 19.29 9.84 L19.29 9.84 L21.78 9.92 A10.0 10.0 0 0 1 21.78 14.08 L19.29 14.16 A7.6 7.6 0 0 1 18.68 15.63 L18.68 15.63 L20.39 17.45 A10.0 10.0 0 0 1 17.45 20.39 L15.63 18.68 A7.6 7.6 0 0 1 14.16 19.29 L14.16 19.29 L14.08 21.78 A10.0 10.0 0 0 1 9.92 21.78 L9.84 19.29 A7.6 7.6 0 0 1 8.37 18.68 L8.37 18.68 L6.55 20.39 A10.0 10.0 0 0 1 3.61 17.45 L5.32 15.63 A7.6 7.6 0 0 1 4.71 14.16 L4.71 14.16 L2.22 14.08 A10.0 10.0 0 0 1 2.22 9.92 L4.71 9.84 A7.6 7.6 0 0 1 5.32 8.37 L5.32 8.37 L3.61 6.55 A10.0 10.0 0 0 1 6.55 3.61 L8.37 5.32 A7.6 7.6 0 0 1 9.84 4.71 Z" fill="none" stroke="url(#settings-gear-grad)" stroke-width="1"/></svg>',
    label: "설정",
    adminOnly: true,
    extraClass: "cat-group-settings",
    items: [
      {
        id: "library-nav-btn",
        label: "라이브러리 관리",
        onClick: () => {
          location.hash = "#/library";
          closeSidebar();
        },
      },
      {
        id: "chatrooms-nav-btn",
        label: "채팅방 참여자 관리",
        onClick: () => {
          location.hash = "#/chatrooms";
          closeSidebar();
        },
      },
    ],
  });
}

// ── 라우팅 ──
const LIST_BG_CLASSES = ["list-bg-main_story", "list-bg-call", "list-bg-talk", "list-bg-diary", "list-bg-voice"];
// 뷰어(개별 기록 화면)에서 리스트보다 더 흐리게 보여줄 카테고리는 여기서 별도 클래스로 덮어쓴다.
const VIEWER_BG_CLASS_MAP = { main_story: "viewer-bg-main_story" };
const ALL_BG_CLASSES = [...LIST_BG_CLASSES, ...Object.values(VIEWER_BG_CLASS_MAP)];

// 배경 클래스는 body(실제로 보이는 영역)와 html(세로 스크롤바가 차지하는
// 거터 영역까지 포함한 캔버스 전체) 양쪽에 동시에 붙여야, 스크롤바 트랙
// 자리만 따로 흰 배경으로 남는 일이 없다.
function toggleBgClass(name, on) {
  document.body.classList.toggle(name, on);
  document.documentElement.classList.toggle(name, on);
}
function addBgClass(name) {
  document.body.classList.add(name);
  document.documentElement.classList.add(name);
}
function removeAllBgClasses() {
  document.body.classList.remove(...ALL_BG_CLASSES);
  document.documentElement.classList.remove(...ALL_BG_CLASSES);
}

const siteLogo = document.getElementById("site-logo");
const siteSubtitle = document.getElementById("site-subtitle");

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  const enteringHome = name === "home";
  toggleBgClass("home-bg-active", enteringHome);
  toggleBgClass("library-bg-active", name === "library" || name === "chatrooms");
  toggleBgClass("editor-bg-active", name === "editor");
  if (name !== "list" && name !== "viewer") {
    removeAllBgClasses();
  }
  if (enteringHome) {
    // display:none → block과 애니메이션 시작이 같은 스타일 계산에서 한꺼번에
    // 일어나면(특히 로그인 직후처럼 여러 화면 전환이 한 프레임 안에 몰릴 때)
    // 애니메이션이 처음부터 재생되지 않고 끝난 상태로 바로 보일 수 있다.
    // display:block을 먼저 확정시키는 리플로우를 강제한 다음에 애니메이션을
    // 트리거하는 클래스를 따로 붙여서 항상 처음부터 재생되게 한다.
    siteLogo.classList.remove("play-in");
    siteSubtitle.classList.remove("play-in");
    void siteLogo.offsetHeight;
    siteLogo.classList.add("play-in");
    siteSubtitle.classList.add("play-in");
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
  } else if (route === "chatrooms") {
    showView("chatrooms");
    renderChatRoomsView();
  } else {
    showView("home");
  }
}

// 카테고리별로 "아직 기록이 없습니다" 빈 상태에 보여줄 아이콘 (lucide-static).
const EMPTY_STATE_ICONS = {
  voice: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22" /><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" /><path d="M5 10v2a7 7 0 0 0 12 5" /><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /><line x1="12" x2="12" y1="19" y2="22" /></svg>',
  call: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 2 6 6" /><path d="m22 2-6 6" /><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" /></svg>',
  talk: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /><path d="M12 11h.01" /><path d="M16 11h.01" /><path d="M8 11h.01" /></svg>',
  diary: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17h1.5" /><path d="M12 22h1.5" /><path d="M12 2h1.5" /><path d="M17.5 22H19a1 1 0 0 0 1-1" /><path d="M17.5 2H19a1 1 0 0 1 1 1v1.5" /><path d="M20 14v3h-2.5" /><path d="M20 8.5V10" /><path d="M4 10V8.5" /><path d="M4 19.5V14" /><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H8" /><path d="M8 22H6.5a1 1 0 0 1 0-5H8" /></svg>',
  main_story: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="m9.5 17 5-5" /><path d="m9.5 12 5 5" /></svg>',
};

// 톡 보관함(시즌별 기록 제외) 리스트에서, 드롭다운으로 아직 아무것도 고르지
// 않았을 때 전체 목록 대신 보여주는 안내.
const PHONE_CALL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2a9 9 0 0 1 9 9" /><path d="M13 6a5 5 0 0 1 5 5" /><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" /></svg>';
// 선택지에 6명 이름이 전부 들어있으면("호감도 톡"처럼 복수 달성이 끼어
// 있어도) "마법사를 선택해 주세요!", 아니면("카드 외 조건별 톡"처럼
// 인물과 무관한 선택지면) "필터를 선택해 주세요!"로 문구를 바꾼다.
function talkFilterHasCharacters(options) {
  return CHARACTERS.every((ch) => options.some((opt) => opt.value === ch.id));
}
function talkPendingSelectionHtml(hasCharacters) {
  const message = hasCharacters ? "마법사를 선택해 주세요!" : "필터를 선택해 주세요!";
  return `<li class="empty-state"><span class="empty-state-icon">${PHONE_CALL_ICON}</span>${message}</li>`;
}

function emptyStateHtml(catId) {
  const icon = EMPTY_STATE_ICONS[catId] || "";
  return `<li class="empty-state"><span class="empty-state-icon">${icon}</span>아직 기록이 없습니다.</li>`;
}

// breadcrumb에서 카테고리 > 하위 카테고리 사이 구분자로 쓰는 chevron-right (lucide).
const BREADCRUMB_CHEVRON = '<svg class="breadcrumb-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>';
// 뷰어·라이브러리·에디터 breadcrumb에서 공통으로 쓰는 뒤로가기 아이콘 (lucide arrow-left).
const ARROW_LEFT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>';

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

// 메인 스토리·전화 기록에서 새 글을 맨 아래에 붙이기 위한 순서 계획.
// 리스트는 order가 있는 글을 먼저(오름차순), 없는 글을 그 뒤에 최신순으로 보여 주기 때문에,
// 새 글에 order만 주면 order 없는 옛 글들보다 위로 올라가 버린다. 그래서 지금 보이는 순서
// 그대로 기존 글에 0, 1, 2…를 다시 매겨(이미 맞는 글은 건드리지 않는다) 두고, 새 글에는
// 그다음 번호를 준다.
async function planAppendOrder(catId, subId) {
  const siblings = await fetchSortedRecords(catId, subId);
  const renumber = [];
  siblings.forEach((r, i) => {
    if (r.order !== i) renumber.push({ id: r.id, order: i });
  });
  return { renumber, newOrder: siblings.length };
}

// 네이티브 select 대신 사이트 스타일에 맞춘 드롭다운(버튼 + 선택지 팝오버).
// wrap 엘리먼트 하나를 받아서 .dropdown-btn/.dropdown-btn-label/.dropdown-menu
// 자식을 찾아 연결한다. select의 .value/change 이벤트와 비슷하게 쓰라고
// value getter/setter와 onChange를 제공한다.
function createDropdown(wrap) {
  const btn = wrap.querySelector(".dropdown-btn");
  const labelEl = wrap.querySelector(".dropdown-btn-label");
  const menuEl = wrap.querySelector(".dropdown-menu");
  let value = "";
  let currentItems = [];
  // renderListView처럼 매번 다시 호출되는 곳에서도 onChange가 계속 쌓이지
  // 않도록(오래된 records를 참조하는 콜백이 중복 실행되지 않도록), 핸들러는
  // 배열이 아니라 하나만 유지하고 onChange를 다시 부르면 덮어쓴다.
  let changeHandler = null;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuEl.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!menuEl.classList.contains("hidden") && !wrap.contains(e.target)) {
      menuEl.classList.add("hidden");
    }
  });

  function applySelection(v) {
    value = v;
    const sel = currentItems.find((it) => it.value === v);
    labelEl.textContent = sel ? sel.label : "";
    menuEl.querySelectorAll(".dropdown-menu-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.value === v);
    });
  }

  // placeholder를 주면("" 포함) selectedValue가 items 안에 없을 때 items[0]으로
  // 자동 선택하는 대신, 아무 항목도 선택 안 된 채로 placeholder 글자를 보여준다
  // (리스트 필터처럼 "전체"를 포함해 사용자가 직접 골라야만 하는 경우에 쓴다).
  function setOptions(items, selectedValue, placeholder) {
    currentItems = items;
    menuEl.innerHTML = items
      .map((it) => `<button type="button" class="dropdown-menu-item" data-value="${it.value}">${it.label}</button>`)
      .join("");
    menuEl.querySelectorAll(".dropdown-menu-item").forEach((itemBtn) => {
      itemBtn.addEventListener("click", () => {
        applySelection(itemBtn.dataset.value);
        menuEl.classList.add("hidden");
        if (changeHandler) changeHandler(value);
      });
    });
    if (items.some((it) => it.value === selectedValue)) {
      applySelection(selectedValue);
    } else if (placeholder !== undefined) {
      value = selectedValue;
      labelEl.textContent = placeholder;
      menuEl.querySelectorAll(".dropdown-menu-item").forEach((b) => b.classList.remove("active"));
    } else {
      applySelection(items[0]?.value ?? "");
    }
  }

  return {
    setOptions,
    get value() {
      return value;
    },
    set value(v) {
      applySelection(v);
    },
    onChange(fn) {
      changeHandler = fn;
    },
  };
}

// 리스트 화면의 인물 필터 드롭다운 (톡 보관함, 시즌별 기록 제외에서만 표시).
const listCharacterFilterWrap = document.getElementById("list-character-filter-wrap");
const listCharacterFilterDropdown = createDropdown(listCharacterFilterWrap);


// ── 보이스 카테고리: 알약 리스트 · 음성 재생 · 음성 파일 등록 ──
// 음성 파일은 Firestore에 저장한다(Storage는 쓰지 않는다). 문서 하나가 1MB
// 제한이라 파일을 약 0.9MB 조각으로 잘라 voices/{기록 id}/parts/{번호}에 넣고,
// voices/{기록 id}에는 형식·크기·조각 수만 둔다. 재생할 때 조각을 모두 받아 하나의
// Blob으로 이어 붙여서 재생하므로 조각 경계에서 끊기지 않는다.
const VOICE_CHUNK_BYTES = 900000;
const VOICE_MAX_BYTES = 2 * 1024 * 1024;
const MIC_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect x="9" y="2" width="6" height="13" rx="3" /></svg>';
const PLUS_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>';
const PENCIL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>';
const TRASH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>';
const SAVE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" /></svg>';

const voiceAudio = new Audio();
const voiceUrlCache = new Map(); // 기록 id -> Blob URL (같은 음성을 다시 틀 때 Firestore를 또 읽지 않는다)
let voicePlayingBtn = null;
let voicePlayToken = 0;

function setVoicePlaying(btn) {
  if (voicePlayingBtn && voicePlayingBtn !== btn) voicePlayingBtn.classList.remove("is-playing");
  voicePlayingBtn = btn;
  if (btn) btn.classList.add("is-playing");
}
function stopVoice() {
  voicePlayToken++;
  voiceAudio.pause();
  if (voicePlayingBtn) voicePlayingBtn.classList.remove("is-playing");
  voicePlayingBtn = null;
}
// 끝나거나 멈추면 아이콘을 원래 색으로 되돌린다.
voiceAudio.addEventListener("ended", () => setVoicePlaying(null));
voiceAudio.addEventListener("pause", () => {
  if (voicePlayingBtn) voicePlayingBtn.classList.remove("is-playing");
});

async function loadVoiceUrl(recordId) {
  if (voiceUrlCache.has(recordId)) return voiceUrlCache.get(recordId);
  const metaSnap = await getDoc(doc(db, "voices", recordId));
  if (!metaSnap.exists()) throw new Error("음성 정보가 없습니다.");
  const meta = metaSnap.data();
  const partsSnap = await getDocs(query(collection(db, "voices", recordId, "parts"), orderBy("i")));
  const parts = partsSnap.docs.map((d) => d.data().data.toUint8Array());
  if (parts.length !== meta.parts) throw new Error("음성 조각이 빠져 있습니다.");
  const url = URL.createObjectURL(new Blob(parts, { type: meta.mime || "audio/mpeg" }));
  voiceUrlCache.set(recordId, url);
  return url;
}

async function toggleVoicePlayback(recordId, btn) {
  if (voicePlayingBtn === btn && !voiceAudio.paused) {
    stopVoice();
    return;
  }
  stopVoice();
  const token = voicePlayToken;
  btn.classList.add("is-loading");
  try {
    const url = await loadVoiceUrl(recordId);
    if (token !== voicePlayToken) return; // 그 사이 다른 걸 눌렀다.
    voiceAudio.src = url;
    voiceAudio.currentTime = 0;
    await voiceAudio.play();
    setVoicePlaying(btn);
  } catch (e) {
    console.error("음성 재생 실패:", e);
    alert("음성을 재생하지 못했습니다: " + (e.message || e.code));
  } finally {
    btn.classList.remove("is-loading");
  }
}

// 사이트 안 확인 팝업. 확인을 누르면 true, 취소·바깥 클릭이면 false.
function confirmDialog(message, okLabel = "삭제") {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const okBtn = document.getElementById("confirm-modal-ok");
    const cancelBtn = document.getElementById("confirm-modal-cancel");
    document.getElementById("confirm-modal-text").textContent = message;
    okBtn.textContent = okLabel;
    const finish = (result) => {
      modal.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      resolve(result);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (e) => {
      if (e.target === modal) finish(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    modal.classList.remove("hidden");
    cancelBtn.focus();
  });
}

// 알약(기록)과 그 음성 조각을 함께 지운다.
async function deleteVoiceRecord(recordId) {
  const parts = await getDocs(collection(adminDb, "voices", recordId, "parts"));
  const batch = writeBatch(adminDb);
  parts.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(adminDb, "voices", recordId));
  batch.delete(doc(adminDb, "records", recordId));
  await batch.commit();
  const url = voiceUrlCache.get(recordId);
  if (url) URL.revokeObjectURL(url);
  voiceUrlCache.delete(recordId);
}

async function saveVoiceFile(recordId, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const total = Math.ceil(bytes.length / VOICE_CHUNK_BYTES);
  const old = await getDocs(collection(adminDb, "voices", recordId, "parts"));
  const batch = writeBatch(adminDb);
  old.docs.forEach((d) => batch.delete(d.ref)); // 다시 올리면 이전 조각을 지운다.
  for (let i = 0; i < total; i++) {
    const chunk = bytes.slice(i * VOICE_CHUNK_BYTES, (i + 1) * VOICE_CHUNK_BYTES);
    batch.set(doc(adminDb, "voices", recordId, "parts", String(i).padStart(4, "0")), {
      i,
      data: Bytes.fromUint8Array(chunk),
    });
  }
  batch.set(doc(adminDb, "voices", recordId), {
    mime: file.type || "audio/mpeg",
    size: bytes.length,
    parts: total,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(adminDb, "records", recordId), { hasVoice: true, updatedAt: serverTimestamp() });
  await batch.commit();
  const oldUrl = voiceUrlCache.get(recordId);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  voiceUrlCache.delete(recordId);
}

// 수정 모드에서 마이크를 누르면 알약 아래에 펼쳐지는 음성 파일 등록 칸.
function buildVoiceEditPanel(data) {
  const panel = document.createElement("div");
  panel.className = "voice-edit-panel";
  panel.innerHTML = `
    <div class="voice-edit-note">${data.hasVoice ? "등록된 음성이 있어요. 새 파일을 저장하면 바뀌어요." : "아직 등록된 음성이 없어요."}</div>
    <div class="voice-edit-row">
      <label class="voice-file-btn">음성 파일 선택<input type="file" accept="audio/*" hidden /></label>
      <span class="voice-file-name">선택한 파일 없음</span>
      <button type="button" class="voice-save-btn">저장</button>
    </div>
    <div class="voice-edit-msg" aria-live="polite"></div>`;
  const input = panel.querySelector("input[type=file]");
  const nameEl = panel.querySelector(".voice-file-name");
  const msgEl = panel.querySelector(".voice-edit-msg");
  const saveBtn = panel.querySelector(".voice-save-btn");
  const showMsg = (text, isError) => {
    msgEl.textContent = text;
    msgEl.classList.toggle("is-error", !!isError);
  };
  input.addEventListener("change", () => {
    const f = input.files[0];
    nameEl.textContent = f ? f.name : "선택한 파일 없음";
    showMsg("");
  });
  saveBtn.addEventListener("click", async () => {
    const f = input.files[0];
    if (!f) return showMsg("음성 파일을 먼저 선택해 주세요.", true);
    if (!f.type.startsWith("audio/")) return showMsg("음성 파일(mp3, m4a 등)만 올릴 수 있어요.", true);
    if (f.size > VOICE_MAX_BYTES) return showMsg("파일이 너무 커요. 2MB 이하로 올려 주세요.", true);
    saveBtn.disabled = true;
    showMsg("저장하는 중...");
    try {
      await saveVoiceFile(data.id, f);
      data.hasVoice = true;
      input.value = "";
      nameEl.textContent = "선택한 파일 없음";
      panel.querySelector(".voice-edit-note").textContent = "저장했어요. 새 음성이 등록돼 있어요.";
      showMsg("");
    } catch (e) {
      console.error("음성 저장 실패:", e);
      showMsg("저장하지 못했어요: " + (e.code || e.message), true);
    } finally {
      saveBtn.disabled = false;
    }
  });
  return panel;
}


// 보이스 리스트 맨 아래 + 버튼 → 대사·음성 파일을 넣는 사이트 내 팝업(관리자만).
const voiceAddWrap = document.getElementById("voice-add-wrap");
const voiceAddBtn = document.getElementById("voice-add-btn");
const voiceModal = document.getElementById("voice-modal");
const voiceLineInput = document.getElementById("voice-line-input");
const voiceNoteInput = document.getElementById("voice-note-input");
const voiceFileInput = document.getElementById("voice-file-input");
const voiceFileNameEl = document.getElementById("voice-file-name");
const voiceTagRow = document.getElementById("voice-tag-row");
const voiceTagDropdown = createDropdown(document.getElementById("voice-tag-wrap"));
const voiceModalMsg = document.getElementById("voice-modal-msg");
const voiceModalSave = document.getElementById("voice-modal-save");
let voiceAddCtx = null; // { catId, subId, records, filterValue(), refresh() } — 지금 열려 있는 보이스 리스트 정보

function closeVoiceModal() {
  voiceModal.classList.add("hidden");
}
function openVoiceModal() {
  if (!voiceAddCtx) return;
  voiceLineInput.value = "";
  voiceNoteInput.value = "";
  voiceFileInput.value = "";
  voiceFileNameEl.textContent = "선택한 파일 없음";
  voiceModalMsg.textContent = "";
  // 리스트에서 "전체"를 보고 있을 때만 분류(홈 화면/옷장/…)를 직접 고르게 한다.
  // 특정 분류를 보고 있으면 그 분류로 저장한다.
  const needsTag = !voiceAddCtx.filterValue();
  voiceTagRow.classList.toggle("hidden", !needsTag);
  if (needsTag) voiceTagDropdown.setOptions(VOICE_FILTER_OPTIONS, "__pending__", "분류를 선택해 주세요");
  voiceModal.classList.remove("hidden");
  voiceLineInput.focus();
}
voiceAddBtn.addEventListener("click", openVoiceModal);
document.getElementById("voice-modal-cancel").addEventListener("click", closeVoiceModal);
voiceModal.addEventListener("click", (e) => {
  if (e.target === voiceModal) closeVoiceModal();
});
voiceFileInput.addEventListener("change", () => {
  const f = voiceFileInput.files[0];
  voiceFileNameEl.textContent = f ? f.name : "선택한 파일 없음";
  voiceModalMsg.textContent = "";
});
voiceModalSave.addEventListener("click", async () => {
  const ctx = voiceAddCtx;
  if (!ctx) return;
  const line = voiceLineInput.value.trim();
  const file = voiceFileInput.files[0];
  // 아직 고르지 않았을 때 드롭다운 값은 "__pending__"라서, 실제 분류 값일 때만 인정한다.
  const pickedTag = VOICE_FILTER_OPTIONS.some((o) => o.value === voiceTagDropdown.value) ? voiceTagDropdown.value : "";
  const tag = ctx.filterValue() || pickedTag;
  if (!line) return (voiceModalMsg.textContent = "대사를 입력해 주세요.");
  if (!tag) return (voiceModalMsg.textContent = "분류를 선택해 주세요.");
  if (file && !file.type.startsWith("audio/")) return (voiceModalMsg.textContent = "음성 파일(mp3, m4a 등)만 올릴 수 있어요.");
  if (file && file.size > VOICE_MAX_BYTES) return (voiceModalMsg.textContent = "파일이 너무 커요. 2MB 이하로 올려 주세요.");
  voiceModalSave.disabled = true;
  voiceModalMsg.textContent = "저장하는 중...";
  try {
    // 새 알약은 맨 아래에 붙도록 지금 있는 순서 값의 최댓값 + 1을 준다.
    const maxOrder = ctx.records.reduce((m, r) => (typeof r.order === "number" ? Math.max(m, r.order) : m), -1);
    const ref = await addDoc(collection(adminDb, "records"), {
      title: line,
      note: voiceNoteInput.value.replace(/\s+/g, " ").trim().slice(0, 200),
      category: ctx.catId,
      subcategory: ctx.subId,
      character: tag,
      tableHtml: "",
      authorUid: adminAuth.currentUser.uid,
      order: maxOrder + 1,
      hasVoice: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (file) {
      try {
        await saveVoiceFile(ref.id, file);
      } catch (e) {
        console.error("음성 저장 실패:", e);
        alert("대사는 저장했지만 음성 파일은 저장하지 못했어요. 목록에서 연필 버튼을 눌러 다시 올려 주세요.");
      }
    }
    closeVoiceModal();
    ctx.refresh();
  } catch (e) {
    console.error("보이스 저장 실패:", e);
    voiceModalMsg.textContent = "저장하지 못했어요: " + (e.code || e.message);
  } finally {
    voiceModalSave.disabled = false;
  }
});

// 수정 모드에서는 알약 안의 대사와 비고를 바로 고칠 수 있다. 글자를 누르고 고친 뒤
// 바깥을 누르거나 Enter를 누르면 저장하고, Esc는 취소다. 한 줄 글이라 줄바꿈은 막는다.
// field: "title"(대사, 비울 수 없음) 또는 "note"(비고, 비워도 됨).
function makePillFieldEditable(el, data, field, { required, max, label, requiredMsg }) {
  el.contentEditable = "true";
  el.spellcheck = false;
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", label);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
    } else if (e.key === "Escape") {
      el.textContent = data[field] || "";
      el.blur();
    }
  });
  el.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\s+/g, " ");
    document.execCommand("insertText", false, text);
  });
  el.addEventListener("blur", async () => {
    const previous = data[field] || "";
    const next = el.textContent.replace(/\s+/g, " ").trim().slice(0, max);
    if (next === previous) {
      el.textContent = previous;
      return;
    }
    if (required && !next) {
      el.textContent = previous;
      alert(requiredMsg);
      return;
    }
    data[field] = next; // 저장이 끝나기 전에 목록이 다시 그려져도 새 내용이 보이게 먼저 반영한다.
    el.textContent = next;
    el.classList.add("is-saving");
    try {
      await updateDoc(doc(adminDb, "records", data.id), { [field]: next, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(`${label} 수정 실패:`, e);
      data[field] = previous;
      el.textContent = previous;
      alert(`${label} 저장에 실패했습니다: ` + (e.code || e.message));
    } finally {
      el.classList.remove("is-saving");
    }
  });
}

let voiceEditMode = false;
function hasUnsavedVoiceFile() {
  return Array.from(document.querySelectorAll(".voice-edit-panel input[type=file]")).some((i) => i.files.length);
}
function createVoicePill(data) {
  const li = document.createElement("li");
  li.className = "voice-pill";
  li.dataset.id = data.id;
  li.innerHTML = `
    <div class="pill-main">
      <div class="pill-text"></div>
      <div class="pill-btns">
        <button type="button" class="pill-delete" aria-label="삭제">${TRASH_ICON}</button>
        <button type="button" class="pill-mic" aria-label="음성 재생">${MIC_ICON}</button>
      </div>
    </div>`;
  const pillText = li.querySelector(".pill-text");
  pillText.textContent = data.title || "(대사 없음)";
  if (voiceEditMode) makePillFieldEditable(pillText, data, "title", { required: true, max: 300, label: "대사", requiredMsg: "대사는 비워 둘 수 없어요." });
  // 비고는 선택 사항: 있을 때, 또는 수정 모드일 때만 대사 왼쪽에 회색 세로선과 함께 나온다(비고 | 대사 | 마이크 순서).
  if (data.note || voiceEditMode) {
    const note = document.createElement("div");
    note.className = "pill-note";
    note.innerHTML = '<span class="pill-note-text" data-placeholder="비고"></span>';
    const noteText = note.querySelector(".pill-note-text");
    noteText.textContent = data.note || "";
    if (voiceEditMode) makePillFieldEditable(noteText, data, "note", { required: false, max: 200, label: "비고" });
    pillText.before(note);
  }
  li.querySelector(".pill-delete").addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog("정말 삭제하시겠어요? 삭제하면 되돌릴 수 없어요.");
    if (!ok || !voiceAddCtx) return;
    try {
      stopVoice();
      await deleteVoiceRecord(data.id);
      voiceAddCtx.remove(data.id);
    } catch (err) {
      console.error("보이스 삭제 실패:", err);
      alert("삭제하지 못했습니다: " + (err.code || err.message));
    }
  });
  const mic = li.querySelector(".pill-mic");
  mic.disabled = !data.hasVoice && !voiceEditMode;
  mic.addEventListener("click", (e) => {
    e.stopPropagation();
    if (voiceEditMode) {
      const open = li.querySelector(".voice-edit-panel");
      if (open) {
        open.remove();
        mic.classList.remove("is-active");
      } else {
        li.appendChild(buildVoiceEditPanel(data));
        mic.classList.add("is-active");
      }
      return;
    }
    if (data.hasVoice) toggleVoicePlayback(data.id, mic);
  });
  return li;
}

// ── 리스트 화면 ──
async function renderListView(catId, subId) {
  const cat = findCategory(catId);
  const sub = findSubcategory(catId, subId);
  document.getElementById("list-breadcrumb").innerHTML = `${cat?.label ?? catId}${BREADCRUMB_CHEVRON}${sub?.label ?? subId}`;

  removeAllBgClasses();
  if (LIST_BG_CLASSES.includes(`list-bg-${catId}`)) {
    addBgClass(`list-bg-${catId}`);
  }

  const newRecordBtn = document.getElementById("new-record-btn");
  const listEl = document.getElementById("record-list");
  const isVoice = catId === "voice";
  let currentList = []; // 지금 화면에 그려진 목록(수정 모드를 켜고 끌 때 다시 그린다)
  stopVoice();
  voiceEditMode = false;
  listEl.classList.toggle("voice-list", isVoice);
  // 메인 스토리에서만: 양옆 버튼으로 이전 층/다음 층 리스트로 넘어간다.
  const floors = catId === "main_story" ? cat?.subcategories ?? [] : [];
  const floorIdx = floors.findIndex((f) => f.id === subId);
  const prevFloor = floorIdx > 0 ? floors[floorIdx - 1] : null;
  const nextFloor = floorIdx >= 0 && floorIdx < floors.length - 1 ? floors[floorIdx + 1] : null;
  listNav.classList.toggle("hidden", floorIdx < 0);
  listPrevBtn.classList.toggle("hidden", !prevFloor);
  listNextBtn.classList.toggle("hidden", !nextFloor);
  listPrevBtn.onclick = prevFloor ? () => { location.hash = `#/list/${catId}/${prevFloor.id}`; } : null;
  listNextBtn.onclick = nextFloor ? () => { location.hash = `#/list/${catId}/${nextFloor.id}`; } : null;
  listPrevBtn.setAttribute("aria-label", prevFloor ? `이전 층 (${prevFloor.label})` : "이전 층");
  listNextBtn.setAttribute("aria-label", nextFloor ? `다음 층 (${nextFloor.label})` : "다음 층");
  positionListNavButtons();
  voiceAddWrap.classList.add("hidden"); // 맨 아래 + 버튼은 연필로 수정 모드에 들어갔을 때만 보인다.
  voiceAddCtx = null;
  if (isVoice) {
    // 보이스 리스트의 + 버튼은 새 기록 추가 대신 수정 모드 스위치(연필 ↔ 저장)다.
    newRecordBtn.innerHTML = PENCIL_ICON;
    newRecordBtn.setAttribute("aria-label", "음성 수정");
    newRecordBtn.onclick = () => {
      if (voiceEditMode && hasUnsavedVoiceFile() && !confirm("저장하지 않은 음성 파일이 있어요. 그래도 수정을 마칠까요?")) return;
      voiceEditMode = !voiceEditMode;
      newRecordBtn.innerHTML = voiceEditMode ? SAVE_ICON : PENCIL_ICON;
      newRecordBtn.setAttribute("aria-label", voiceEditMode ? "수정 마치기" : "음성 수정");
      listEl.classList.toggle("is-editing", voiceEditMode);
      voiceAddWrap.classList.toggle("hidden", !voiceEditMode);
      rerenderCurrentList();
    };
  } else {
    newRecordBtn.innerHTML = PLUS_ICON;
    newRecordBtn.setAttribute("aria-label", "새 기록 추가");
    listEl.classList.remove("is-editing");
    newRecordBtn.onclick = () => {
      location.hash = `#/new/${catId}/${subId}`;
    };
  }

  listEl.innerHTML = "<li class='empty-state'>불러오는 중...</li>";

  let records;
  try {
    records = await fetchSortedRecords(catId, subId);
  } catch (e) {
    console.error("리스트 조회 실패:", e.code, e.message);
    listEl.innerHTML = `<li class='empty-state'>목록을 불러오지 못했습니다: ${e.code || e.message}<br>(Firestore에 복합 색인이 필요할 수 있어요 — 콘솔 오류 메시지의 링크를 확인해주세요)</li>`;
    return;
  }

  currentList = records;
  if (isVoice) {
    voiceAddCtx = {
      catId,
      subId,
      records,
      filterValue: () => listCharacterFilterDropdown.value,
      refresh: () => renderListView(catId, subId),
      // 지운 알약만 목록에서 빼고 다시 그린다(수정 모드는 그대로 유지).
      remove: (id) => {
        records = records.filter((r) => r.id !== id);
        currentList = currentList.filter((r) => r.id !== id);
        voiceAddCtx.records = records;
        rerenderCurrentList();
      },
    };
  }
  function rerenderCurrentList() {
    stopVoice();
    renderRecords(currentList);
  }
  function renderRecords(list) {
    currentList = list;
    if (list.length === 0) {
      listEl.innerHTML = emptyStateHtml(catId);
      return;
    }
    listEl.innerHTML = "";
    list.forEach((data) => {
      if (isVoice) {
        listEl.appendChild(createVoicePill(data));
        return;
      }
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

  // 톡 보관함(시즌별 기록 제외)·다이어리·보이스(모든 하위 카테고리)에서, 하위
  // 카테고리에 맞는 선택지로 걸러 보는 드롭다운을 보여준다. 톡 보관함은
  // 일별 톡만 예전처럼 "전체"가 기본 선택된 채 바로 전체 목록을 보여주고
  // 나머지는 직접 고르기 전까지 선택을 안내하며, 다이어리는 항상 "전체"가
  // 기본 선택된 채 바로 보여준다.
  const showsFilter = categoryHasFilter(catId, subId);
  if (showsFilter) {
    const items = [{ value: "", label: "전체" }, ...getFilterOptions(catId, subId)];
    listCharacterFilterDropdown.onChange((val) => {
      renderRecords(val ? records.filter((r) => r.character === val) : records);
    });
    listCharacterFilterWrap.classList.remove("hidden");
    if (catId === "diary" || catId === "voice" || subId === "daily") {
      listCharacterFilterDropdown.setOptions(items, "");
      renderRecords(records);
    } else {
      listCharacterFilterDropdown.setOptions(items, "__pending__", "");
      listEl.innerHTML = talkPendingSelectionHtml(talkFilterHasCharacters(getTalkFilterOptions(subId)));
    }
  } else {
    listCharacterFilterWrap.classList.add("hidden");
    renderRecords(records);
  }
}

// ── 리스트 드래그 정렬 ──
// 관리자 모드 + 데스크탑(768px 초과)에서만 드래그로 순서를 바꿀 수 있다 — 모바일은
// 터치로 스크롤하다가 실수로 순서가 바뀌기 쉬워서 아예 막았다. 그 결과(order
// 필드)는 뷰어를 포함한 모두에게 동일하게 적용된다.
let listSortableInstance = null;

function isDesktopViewport() {
  return document.documentElement.clientWidth > 768;
}
window.addEventListener("resize", () => {
  if (listSortableInstance) listSortableInstance.option("disabled", !isAdmin || !isDesktopViewport());
});

function initListSortable() {
  if (listSortableInstance) {
    listSortableInstance.destroy();
    listSortableInstance = null;
  }
  if (typeof Sortable === "undefined") return;
  const listEl = document.getElementById("record-list");
  listSortableInstance = Sortable.create(listEl, {
    animation: 150,
    // 보이스 알약의 마이크 버튼과 음성 등록 칸은 드래그가 아니라 눌러서 쓰는 곳이다.
    filter: ".pill-mic, .pill-delete, .voice-edit-panel, .pill-text[contenteditable], .pill-note-text[contenteditable]",
    preventOnFilter: false,
    disabled: !isAdmin || !isDesktopViewport(),
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


// ── 다른 기록 불러오기 팝업 ──
// 로그의 "/불러오기 기록 제목" 줄을 누르면, 그 제목의 기록을 찾아서 로그 위에 팝업으로 보여 준다.
// 바깥 배경·X 버튼·Esc·(휴대폰) 뒤로가기로 닫으면 다시 원래 로그다. 팝업 안의 링크를 누르면 그 위에
// 한 겹 더 뜨고, 닫으면 한 겹씩 돌아온다.
// 닫는 방법을 하나로 맞추려고, 팝업을 열 때 브라우저 기록에 항목을 하나 쌓고(pushState) 닫을 때는
// 전부 history.back()으로 되돌린다. 그러면 뒤로가기 버튼도 같은 길로 팝업만 닫는다.
const recordPopupCache = new Map(); // 제목 -> 찾은 기록(못 찾은 건 저장하지 않아서 나중에 만든 기록도 찾는다)
const recordPopupStack = []; // 지금 떠 있는 팝업들(맨 뒤가 맨 위)
const X_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>';

async function findRecordByTitle(title) {
  if (recordPopupCache.has(title)) return recordPopupCache.get(title);
  // 톡 보관함은 말머리 없이 "채팅방 이름 - 제목"만 써도 찾고(titleKey), 그 밖에는 제목 전체가 같은
  // 기록을 찾는다. 말머리까지 쓴 예전 방식도 그대로 된다.
  let snap = await getDocs(query(collection(db, "records"), where("titleKey", "==", talkTitleKey(title))));
  if (!snap.docs.length) snap = await getDocs(query(collection(db, "records"), where("title", "==", title)));
  const found = snap.docs.length ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null;
  if (found) recordPopupCache.set(title, found);
  return found;
}

// 참여자 n명을 한 줄 최대 perRow명으로 나눌 때 줄별 인원. 줄 수는 필요한 만큼만 두고 인원은 고르게,
// 남는 한 명씩은 뒤쪽 줄로 보낸다(5명 -> [2, 3], 7명 -> [3, 4]).
function avatarRowSizes(n, perRow) {
  if (n <= 0) return [];
  const rows = Math.max(1, Math.ceil(n / perRow));
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i >= rows - extra ? 1 : 0));
}

function removeTopRecordPopup() {
  const top = recordPopupStack.pop();
  if (!top) return;
  document.removeEventListener("keydown", top.onKey, true);
  top.backdrop.remove();
  if (!recordPopupStack.length) document.body.classList.remove("popup-open");
}
// 뒤로가기(또는 위의 닫기 동작이 부른 history.back())가 일어나면, 기록에 남은 팝업 수에 맞춰 닫는다.
window.addEventListener("popstate", (e) => {
  const wanted = e.state && typeof e.state.recordPopup === "number" ? e.state.recordPopup : 0;
  while (recordPopupStack.length > wanted) removeTopRecordPopup();
});
// 다른 화면으로 넘어가면 남은 팝업은 모두 걷는다.
window.addEventListener("hashchange", () => {
  while (recordPopupStack.length) removeTopRecordPopup();
});

async function openRecordPopup(title) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop record-popup-backdrop";
  backdrop.style.zIndex = String(110 + recordPopupStack.length);
  backdrop.innerHTML = `
    <div class="modal-card record-popup-card" role="dialog" aria-modal="true">
      <div class="record-popup-head">
        <h3 class="record-popup-title"></h3>
        <div class="chatroom-card-avatars record-popup-avatars"></div>
        <button type="button" class="record-popup-close" aria-label="닫기">${X_ICON}</button>
      </div>
      <div class="record-popup-body log-render"></div>
    </div>`;
  backdrop.querySelector(".record-popup-title").textContent = title;
  const body = backdrop.querySelector(".record-popup-body");
  body.textContent = "불러오는 중...";

  const entry = { backdrop, closing: false, onKey: null };
  // 닫기는 항상 맨 위 팝업만, 한 번만.
  const dismiss = () => {
    if (entry.closing || recordPopupStack[recordPopupStack.length - 1] !== entry) return;
    entry.closing = true;
    history.back();
  };
  entry.onKey = (e) => {
    if (e.key === "Escape" && recordPopupStack[recordPopupStack.length - 1] === entry) {
      e.stopPropagation();
      dismiss();
    }
  };
  document.addEventListener("keydown", entry.onKey, true);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) dismiss();
  });
  backdrop.querySelector(".record-popup-close").addEventListener("click", dismiss);

  recordPopupStack.push(entry);
  document.body.appendChild(backdrop);
  document.body.classList.add("popup-open");
  history.pushState({ recordPopup: recordPopupStack.length }, "");

  let record = null;
  try {
    record = await findRecordByTitle(title);
  } catch (e) {
    console.error("불러오기 실패:", e);
    body.textContent = "기록을 불러오지 못했어요.";
    return;
  }
  if (!record) {
    body.textContent = "해당 제목의 기록을 찾을 수 없어요.";
    return;
  }
  // 팝업 배경은 그 기록이 속한 카테고리의 배경(톡 보관함·전화 기록 등)을 쓴다.
  backdrop.querySelector(".record-popup-card").classList.add(`bg-${record.category}`);
  // 팝업 제목은 말머리를 뺀 "이름 - 제목"으로 보여 준다(톡 보관함·전화 기록). 다른 카테고리는 제목 그대로.
  backdrop.querySelector(".record-popup-title").textContent =
    record.category === "talk" || record.category === "call" ? talkTitleKey(record.title || title) : record.title || title;
  // 참여자 프로필 사진(톡 보관함)은 제목 줄 오른쪽 끝에, 채팅방 참여자 관리처럼 겹쳐서 보여 준다.
  if (record.category === "talk") {
    resolveViewerParticipants(record).then((keys) => {
      const imgs = keys
        .map((key) => libraryData[key])
        .filter(Boolean)
        .map((entry) => `<img src="${entry.src}" alt="" />`);
      // 모바일에서는 한 줄에 4명까지만 두고 줄마다 비슷하게 나눈다(5명 2+3, 6명 3+3, 7명 3+4).
      // 데스크탑은 한 줄로 그대로 보여 준다.
      const perRow = window.matchMedia("(max-width: 768px)").matches ? 4 : Infinity;
      let html = "";
      let start = 0;
      avatarRowSizes(imgs.length, perRow).forEach((size) => {
        html += `<div class="avatar-row">${imgs.slice(start, start + size).join("")}</div>`;
        start += size;
      });
      backdrop.querySelector(".record-popup-avatars").innerHTML = html;
    });
  }
  body.innerHTML = record.tableHtml || "";
  body.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  body.querySelectorAll(".editor-toggle.open").forEach((el) => el.classList.remove("open"));
  // 톡 보관함과 전화 기록은 프로필 사진·이름 색이 같고, 말풍선만 톡 보관함에만 있다.
  const isTalk = record.category === "talk";
  const talkStyle = isTalk || record.category === "call";
  renderLog(body, libraryData, { showAvatars: talkStyle, bubbles: isTalk, nameStyle: talkStyle, onOpenRecord: openRecordPopup });
}

// 저장할 때 "/불러오기" 줄의 제목이 실제 기록과 맞는지 확인하기 위한 도우미.
function extractLinkTitles(tableHtml) {
  const tmp = document.createElement("div");
  tmp.innerHTML = tableHtml;
  const titles = new Set();
  tmp.querySelectorAll("tr").forEach((tr) => {
    const cell = tr.querySelector("td");
    if (!cell) return;
    const text = cell.textContent.replace(/\u00a0/g, " ").trim();
    if (text.startsWith("/불러오기")) {
      const t = text.slice("/불러오기".length).trim();
      if (t) titles.add(t);
    }
  });
  return Array.from(titles);
}
async function findMissingLinkTitles(tableHtml, ownTitle) {
  const own = new Set([ownTitle, talkTitleKey(ownTitle)]);
  const missing = [];
  for (const t of extractLinkTitles(tableHtml)) {
    if (own.has(t) || own.has(talkTitleKey(t))) continue; // 지금 저장하는 기록 자신은 아직 없을 수 있다.
    try {
      if (!(await findRecordByTitle(t))) missing.push(t);
    } catch (e) {
      console.error("불러오기 제목 확인 실패:", e); // 확인이 안 되는 건 저장을 막지 않는다.
    }
  }
  return missing;
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
  // 데스크탑에서는 창이 아니라 #app-shell이 스크롤되므로, 스크롤바를 뺀 그 칸의 너비를 기준으로 한다.
  const viewportWidth = document.getElementById("app-shell").clientWidth || document.documentElement.clientWidth;
  if (viewportWidth <= 768) return;
  const card = document.querySelector(".viewer-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const btnWidth = 44;
  // 카드 바깥, 화면 가장자리까지 남는 여백의 정중앙에 버튼을 놓는다.
  const leftSpace = rect.left;
  const rightSpace = viewportWidth - rect.right;
  viewerPrevBtn.style.left = `${Math.max(8, (leftSpace - btnWidth) / 2)}px`;
  const gutter = Math.max(0, document.documentElement.clientWidth - viewportWidth); // #app-shell 스크롤바 칸
  viewerNextBtn.style.right = `${gutter + Math.max(8, (rightSpace - btnWidth) / 2)}px`;
}
window.addEventListener("resize", positionViewerNavButtons);

// 메인 스토리 리스트 양옆의 층 이동 버튼(문 아이콘). 기록 화면의 이전/다음 글 버튼과
// 같은 모양·같은 위치 규칙인데, 기준이 되는 상자가 리스트 영역(#list-view)이다.
const listNav = document.getElementById("list-nav");
const listPrevBtn = document.getElementById("list-prev-btn");
const listNextBtn = document.getElementById("list-next-btn");
function positionListNavButtons() {
  // 데스크탑에서는 창이 아니라 #app-shell이 스크롤되므로, 스크롤바를 뺀 그 칸의 너비를 기준으로 한다.
  const viewportWidth = document.getElementById("app-shell").clientWidth || document.documentElement.clientWidth;
  if (viewportWidth <= 768) return;
  const rect = document.getElementById("list-view").getBoundingClientRect();
  if (rect.width === 0) return;
  const btnWidth = 44;
  listPrevBtn.style.left = `${Math.max(8, (rect.left - btnWidth) / 2)}px`;
  const gutter = Math.max(0, document.documentElement.clientWidth - viewportWidth); // #app-shell 스크롤바 칸
  listNextBtn.style.right = `${gutter + Math.max(8, (viewportWidth - rect.right - btnWidth) / 2)}px`;
}
window.addEventListener("resize", positionListNavButtons);

// 톡 보관함 기록 제목은 "[말머리] 채팅방 이름 - 제목" 형식이다. "]" 다음부터
// 첫 "-" 전까지가 채팅방 이름.
function extractChatRoomName(title) {
  return parseTalkTitle(title).chatroom || null;
}

// 톡 보관함 기록은 제목에서 읽은 채팅방 이름으로 chatRooms에 등록된 참여자를
// 찾아 쓴다. 매칭되는 채팅방이 없으면(아직 등록 전이거나 톡 보관함이 아니면)
// 예전 방식대로 기록에 직접 저장된 participants로 대신한다.
async function resolveViewerParticipants(data) {
  if (data.category === "talk") {
    const roomName = extractChatRoomName(data.title);
    if (roomName) {
      try {
        const snap = await getDocs(query(collection(db, "chatRooms"), where("name", "==", roomName)));
        if (!snap.empty) return snap.docs[0].data().participants || [];
      } catch (e) {
        console.error("채팅방 조회 실패:", e.code, e.message);
      }
    }
  }
  return Array.isArray(data.participants) ? data.participants : [];
}

async function renderViewerView(recordId) {
  const viewerContent = document.getElementById("viewer-content");
  const viewerTitle = document.getElementById("viewer-title");
  const viewerBreadcrumb = document.getElementById("viewer-breadcrumb");
  const viewerEditLink = document.getElementById("viewer-edit-link");
  const viewerDeleteBtn = document.getElementById("viewer-delete-btn");
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

  removeAllBgClasses();
  if (VIEWER_BG_CLASS_MAP[data.category]) {
    addBgClass(VIEWER_BG_CLASS_MAP[data.category]);
  } else if (LIST_BG_CLASSES.includes(`list-bg-${data.category}`)) {
    addBgClass(`list-bg-${data.category}`);
  }

  viewerBreadcrumb.innerHTML = `<a href="#/list/${data.category}/${data.subcategory}" class="viewer-back-link" aria-label="목록으로">${ARROW_LEFT_ICON}</a><div class="viewer-breadcrumb-path">${cat?.label ?? data.category}${BREADCRUMB_CHEVRON}${sub?.label ?? data.subcategory}</div>`;
  viewerEditLink.href = `#/edit/${recordId}`;
  viewerDeleteBtn.onclick = async () => {
    if (!confirm(`"${data.title || "(제목 없음)"}" 기록을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await deleteDoc(doc(adminDb, "records", recordId));
      location.hash = `#/list/${data.category}/${data.subcategory}`;
    } catch (e) {
      console.error("삭제 실패:", e.code, e.message);
      alert("삭제에 실패했습니다: " + (e.code || e.message));
    }
  };
  applyAdminUI();
  viewerTitle.textContent = data.title || "(제목 없음)";
  const viewerParticipants = document.getElementById("viewer-participants");
  viewerParticipants.innerHTML = "";
  resolveViewerParticipants(data).then((participantKeys) => {
    viewerParticipants.innerHTML = participantKeys
      .map((key) => libraryData[key])
      .filter(Boolean)
      .map((entry) => `<img src="${entry.src}" alt="" />`)
      .join("");
  });
  viewerContent.innerHTML = data.tableHtml || "";
  // 토글 제목 등 수정창에서만 필요했던 contenteditable 흔적은 읽기 전용 화면에서 지운다.
  viewerContent.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  // 에디터에서는 토글을 삽입하면 기본이 열림 상태라 그 상태 그대로 저장돼 있는데,
  // 뷰어에서는 매번 새로 열 때마다(뒤로가기 후 다시 들어와도) 닫힌 상태로 시작하게 한다.
  viewerContent.querySelectorAll(".editor-toggle.open").forEach((el) => el.classList.remove("open"));
  // 프로필 사진·이름 색은 톡 보관함과 전화 기록에서 보여주고, 말풍선은 톡 보관함에서만 쓴다.
  const talkStyle = data.category === "talk" || data.category === "call";
  renderLog(viewerContent, libraryData, { showAvatars: talkStyle, bubbles: data.category === "talk", nameStyle: talkStyle, onOpenRecord: openRecordPopup });

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
const recordTitleRow = document.getElementById("record-title-row");
const recordTitleInput = document.getElementById("record-title");
const recordTalkTitleRow = document.getElementById("record-talk-title-row");
const recordPrefixInput = document.getElementById("record-prefix-input");
const recordSubtitleInput = document.getElementById("record-subtitle-input");
const recordChatroomDropdown = createDropdown(document.getElementById("record-chatroom-wrap"));
const recordCategoryDropdown = createDropdown(document.getElementById("record-category-wrap"));
const recordSubcategoryDropdown = createDropdown(document.getElementById("record-subcategory-wrap"));
const recordCharacterWrap = document.getElementById("record-character-wrap");
const recordCharacterDropdown = createDropdown(recordCharacterWrap);
const editorContent = document.getElementById("editor-content");
const editorBreadcrumb = document.getElementById("editor-breadcrumb");
const editorUndo = setupUndoRedo(editorContent);

// "[말머리] 채팅방 이름 - 제목" 형식의 제목을 세 조각으로 쪼개거나 다시 합친다.
// 말머리는 선택 입력이라 "채팅방 이름 - 제목"처럼 대괄호 없이 올 수도 있다.
// 뷰어의 extractChatRoomName도 이 파서를 함께 쓴다.
// 제목에서 맨 앞 말머리 "[…]"를 뺀 "이름 - 제목" 꼴. "/불러오기"에서 말머리 없이 기록을 찾을 수 있도록
// 톡 보관함·전화 기록에 titleKey로 같이 저장해 둔다(관리자 스크립트의 백필과 같은 규칙).
function talkTitleKey(title) {
  const bs = title.indexOf("[");
  const be = title.indexOf("]");
  const rest = bs !== -1 && be !== -1 && be > bs ? title.slice(be + 1) : title;
  const d = rest.indexOf("-");
  return d === -1 ? rest.trim() : `${rest.slice(0, d).trim()} - ${rest.slice(d + 1).trim()}`;
}

function parseTalkTitle(title) {
  if (!title) return { prefix: "", chatroom: "", subtitle: "" };
  const bracketStart = title.indexOf("[");
  const bracketEnd = title.indexOf("]");
  let prefix = "";
  let rest = title;
  if (bracketStart !== -1 && bracketEnd !== -1 && bracketEnd > bracketStart) {
    prefix = title.slice(bracketStart + 1, bracketEnd).trim();
    rest = title.slice(bracketEnd + 1);
  }
  const dashIdx = rest.indexOf("-");
  if (dashIdx === -1) return { prefix, chatroom: rest.trim(), subtitle: "" };
  return { prefix, chatroom: rest.slice(0, dashIdx).trim(), subtitle: rest.slice(dashIdx + 1).trim() };
}
function composeTalkTitle(prefix, chatroom, subtitle) {
  return prefix ? `[${prefix}] ${chatroom} - ${subtitle}` : `${chatroom} - ${subtitle}`;
}

function updateTitleRowVisibility() {
  const isTalk = recordCategoryDropdown.value === "talk";
  recordTitleRow.classList.toggle("hidden", isTalk);
  recordTalkTitleRow.classList.toggle("hidden", !isTalk);
}

// 채팅방 참여자 관리에 등록된 채팅방 이름들로 드롭다운을 채운다.
async function loadChatroomOptions(selectedName = "") {
  let rooms = [];
  try {
    const snap = await getDocs(query(collection(db, "chatRooms"), orderBy("createdAt")));
    rooms = snap.docs.map((d) => d.data().name);
  } catch (e) {
    console.error("채팅방 목록 조회 실패:", e.code, e.message);
  }
  const items = [{ value: "", label: "채팅방 선택" }, ...rooms.map((name) => ({ value: name, label: name }))];
  recordChatroomDropdown.setOptions(items, selectedName);
}

recordCategoryDropdown.setOptions(
  CATEGORIES.map((cat) => ({ value: cat.id, label: cat.label })),
  CATEGORIES[0].id
);

function fillSubcategorySelect(catId, selectedSubId) {
  const cat = findCategory(catId);
  if (!cat) return;
  recordSubcategoryDropdown.setOptions(
    cat.subcategories.map((sub) => ({ value: sub.id, label: sub.label })),
    selectedSubId
  );
}

// 하위 카테고리마다 선택지가 달라서(예: 호감도 톡은 인물+복수 달성, 카드 외
// 조건별 기록은 소환사 레벨업/스토리 열람), 매번 현재 하위 카테고리에 맞는
// 목록으로 다시 채운다.
function updateCharacterOptions(selectedValue) {
  recordCharacterDropdown.setOptions(
    getFilterOptions(recordCategoryDropdown.value, recordSubcategoryDropdown.value),
    selectedValue ?? recordCharacterDropdown.value
  );
}

function updateCharacterFieldVisibility() {
  const cat = recordCategoryDropdown.value;
  const show = categoryHasFilter(cat, recordSubcategoryDropdown.value);
  recordCharacterWrap.classList.toggle("hidden", !show);
}

recordCategoryDropdown.onChange(() => {
  fillSubcategorySelect(recordCategoryDropdown.value);
  updateCharacterOptions("");
  updateCharacterFieldVisibility();
  updateTitleRowVisibility();
  if (recordCategoryDropdown.value === "talk") loadChatroomOptions();
});
recordSubcategoryDropdown.onChange(() => {
  updateCharacterOptions("");
  updateCharacterFieldVisibility();
});

let editingRecordId = null;

async function renderEditorView({ categoryId, subcategoryId, recordId }) {
  editingRecordId = recordId || null;
  recordTitleInput.value = "";
  recordPrefixInput.value = "";
  recordSubtitleInput.value = "";
  editorContent.innerHTML = "";

  if (recordId) {
    editorBreadcrumb.innerHTML = `<a href="#/view/${recordId}" class="viewer-back-link" aria-label="기록으로">${ARROW_LEFT_ICON}</a> &nbsp;·&nbsp; <span class="editor-breadcrumb-label">기록 수정</span>`;
    const snap = await getDoc(doc(db, "records", recordId));
    if (snap.exists()) {
      const data = snap.data();
      recordCategoryDropdown.value = data.category;
      fillSubcategorySelect(data.category, data.subcategory);
      updateCharacterOptions(data.character || "");
      if (data.category === "talk") {
        const parsed = parseTalkTitle(data.title);
        recordPrefixInput.value = parsed.prefix;
        recordSubtitleInput.value = parsed.subtitle;
        await loadChatroomOptions(parsed.chatroom);
      } else {
        recordTitleInput.value = data.title || "";
      }
      editorContent.innerHTML = data.tableHtml || "";
    }
  } else {
    editorBreadcrumb.innerHTML = `<a href="#/list/${categoryId}/${subcategoryId}" class="viewer-back-link" aria-label="목록으로">${ARROW_LEFT_ICON}</a> &nbsp;·&nbsp; <span class="editor-breadcrumb-label">새 기록 추가</span>`;
    recordCategoryDropdown.value = categoryId;
    fillSubcategorySelect(categoryId, subcategoryId);
    updateCharacterOptions("");
    if (categoryId === "talk") await loadChatroomOptions();
  }
  updateCharacterFieldVisibility();
  updateTitleRowVisibility();
  editorUndo.reset();
}

// 서식 버튼 (굵게/기울임)
document.querySelectorAll("#editor-toolbar button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => {
    ensureEditorFocus();
    document.execCommand(btn.dataset.cmd, false, null);
  });
});

// ── 글자색 (그리드 선택) ──
// 꼭 이 순서대로 넣어달라고 한 색 목록.
const TEXT_COLORS = ["#f89009", "#ee2323", "#9d9d9d", "#ff8100", "#00D000", "#00efff", "#c38a8b", "#ff59b5", "#2d383a"];

const colorPickerBtn = document.getElementById("btn-color-picker");
const colorPickerGrid = document.getElementById("color-picker-grid");
let colorPickerSavedRange = null;

// 첫 3개는 첫 줄, 나머지 6개는 둘째 줄에 오도록 두 줄로 나눠서 넣는다.
const colorRow = (colors) =>
  `<div class="color-row">${colors
    .map((color) => `<button type="button" class="color-swatch" style="background-color:${color}" data-color="${color}" aria-label="${color}"></button>`)
    .join("")}</div>`;
colorPickerGrid.innerHTML = colorRow(TEXT_COLORS.slice(0, 3)) + colorRow(TEXT_COLORS.slice(3));

colorPickerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const sel = window.getSelection();
  colorPickerSavedRange =
    sel.rangeCount > 0 && editorContent.contains(sel.getRangeAt(0).startContainer)
      ? sel.getRangeAt(0).cloneRange()
      : null;
  colorPickerGrid.classList.toggle("hidden");
});

colorPickerGrid.addEventListener("click", (e) => {
  const swatch = e.target.closest(".color-swatch");
  if (!swatch) return;
  if (colorPickerSavedRange) {
    restoreRangeAndFocus(colorPickerSavedRange, editorContent);
  } else {
    ensureEditorFocus();
  }
  document.execCommand("foreColor", false, swatch.dataset.color);
  colorPickerGrid.classList.add("hidden");
});

document.addEventListener("click", (e) => {
  if (!colorPickerGrid.classList.contains("hidden") && !e.target.closest("#btn-color-picker") && !e.target.closest("#color-picker-grid")) {
    colorPickerGrid.classList.add("hidden");
  }
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
  // 에디터에서는 제목이 contenteditable이라, 제목을 눌렀을 때 열고 닫히면
  // 커서 놓기가 불가능해진다. 뷰어에서는 제목이 그냥 텍스트라 눌러서
  // 열고 닫아도 문제없어서, 뷰어에서만 제목 클릭도 토글로 인정한다.
  const isInEditor = !!e.target.closest("#editor-content");
  if (isInEditor && e.target.closest(".editor-toggle-title")) return;
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

// 커서가 놓인 바로 그 행만 삭제한다. 실행취소(Ctrl+Z)로 되돌릴 수 있어서
// 확인창 없이 바로 지운다.
document.getElementById("btn-delete-row").addEventListener("click", () => {
  const tr = getCursorRow();
  if (!tr) {
    alert("커서를 삭제할 행(표 안의 칸)에 놓아주세요.");
    return;
  }
  tr.remove();
});

// 카테고리 줄 오른쪽의 도움말(접기/표 유지 문법 설명) 팝오버
const editorHelpBtn = document.getElementById("btn-editor-help");
const editorHelpPopover = document.getElementById("editor-help-popover");
editorHelpBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  editorHelpPopover.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!editorHelpPopover.classList.contains("hidden") && !e.target.closest("#btn-editor-help") && !e.target.closest("#editor-help-popover")) {
    editorHelpPopover.classList.add("hidden");
  }
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

// ── 이모티콘 삽입 ──
// 파일명만 여기 채워 넣으면 된다 (images/emoticons/ 안에 실제 파일이 있어야 함).
const EMOTICON_FILES = Array.from({ length: 14 }, (_, i) => `${i + 1}.jpg`);

const emoticonBtn = document.getElementById("btn-insert-emoticon");
const emoticonPicker = document.getElementById("emoticon-picker");
let emoticonSavedRange = null;

emoticonPicker.innerHTML = EMOTICON_FILES.map(
  (file) => `<img src="images/emoticons/${file}" alt="" data-file="${file}" />`
).join("");

emoticonBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  // 팝업이 뜨면서 포커스/선택 영역이 바뀌기 전에, 지금 에디터 안 커서 위치를
  // 저장해둔다 (HTML 붙여넣기 모달과 같은 방식).
  const sel = window.getSelection();
  emoticonSavedRange =
    sel.rangeCount > 0 && editorContent.contains(sel.getRangeAt(0).startContainer)
      ? sel.getRangeAt(0).cloneRange()
      : null;
  emoticonPicker.classList.toggle("hidden");
});

emoticonPicker.addEventListener("click", (e) => {
  const img = e.target.closest("img");
  if (!img) return;
  if (emoticonSavedRange) {
    restoreRangeAndFocus(emoticonSavedRange, editorContent);
  } else {
    ensureEditorFocus();
  }
  document.execCommand("insertHTML", false, `<img class="log-emoticon" src="${img.getAttribute("src")}" alt="" />`);
  emoticonPicker.classList.add("hidden");
});

document.addEventListener("click", (e) => {
  if (!emoticonPicker.classList.contains("hidden") && !e.target.closest("#btn-insert-emoticon") && !e.target.closest("#emoticon-picker")) {
    emoticonPicker.classList.add("hidden");
  }
});

// 저장
document.getElementById("save-record-btn").addEventListener("click", async () => {
  const category = recordCategoryDropdown.value;
  const subcategory = recordSubcategoryDropdown.value;
  const character = categoryHasFilter(category, subcategory) ? recordCharacterDropdown.value : null;
  const tableHtml = editorContent.innerHTML;

  let title;
  if (category === "talk") {
    const prefix = recordPrefixInput.value.trim();
    const chatroom = recordChatroomDropdown.value;
    const subtitle = recordSubtitleInput.value.trim();
    if (!chatroom || !subtitle) {
      alert("채팅방, 제목을 입력해주세요.");
      return;
    }
    title = composeTalkTitle(prefix, chatroom, subtitle);
  } else {
    title = recordTitleInput.value.trim();
    if (!title) {
      alert("제목을 입력해주세요.");
      return;
    }
  }

  // "/불러오기"에 쓴 제목이 실제 기록과 안 맞으면(오타 등) 저장 전에 알려 준다. 그래도 저장은 할 수 있다.
  recordPopupCache.clear();
  const missingLinks = await findMissingLinkTitles(tableHtml, title);
  if (missingLinks.length) {
    const message = "불러오기에 쓴 제목 중 찾을 수 없는 기록이 있어요.\n" + missingLinks.map((t) => `· ${t}`).join("\n") + "\n";
    const ok = await confirmDialog(message + "그래도 저장할까요?", "그래도 저장");
    if (!ok) return;
  }

  try {
    if (editingRecordId) {
      await updateDoc(doc(adminDb, "records", editingRecordId), {
        title,
        titleKey: category === "talk" || category === "call" ? talkTitleKey(title) : deleteField(),
        category,
        subcategory,
        character,
        tableHtml,
        updatedAt: serverTimestamp(),
      });
      location.hash = `#/view/${editingRecordId}`;
    } else if (category === "main_story" || category === "call") {
      // 메인 스토리와 전화 기록은 새 글이 기존 글 아래(맨 끝)에 오게 한다.
      const plan = await planAppendOrder(category, subcategory);
      const batch = writeBatch(adminDb);
      plan.renumber.forEach((x) => batch.update(doc(adminDb, "records", x.id), { order: x.order }));
      const newRef = doc(collection(adminDb, "records"));
      batch.set(newRef, {
        title,
        // 전화 기록은 "/불러오기"에서 말머리 없이 찾을 수 있도록 말머리를 뺀 제목도 같이 저장한다.
        ...(category === "call" ? { titleKey: talkTitleKey(title) } : {}),
        category,
        subcategory,
        character,
        tableHtml,
        authorUid: adminAuth.currentUser.uid,
        order: plan.newOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      location.hash = `#/view/${newRef.id}`;
    } else {
      const newDoc = await addDoc(collection(adminDb, "records"), {
        title,
        ...(category === "talk" || category === "call" ? { titleKey: talkTitleKey(title) } : {}),
        category,
        subcategory,
        character,
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

// ── 채팅방 참여자 관리 ──
// 톡 보관함 기록의 제목(예: [말머리] 채팅방 이름 - 제목)에서 채팅방 이름을
// 읽어 참여자 프사를 뷰어에 자동으로 띄우기 위한 사전 설정. chatRooms
// 컬렉션에 채팅방 이름과 참여자(캐릭터 라이브러리 "이름|색" 키 배열)를
// 등록해둔다.
async function renderChatRoomsView() {
  document.getElementById("chatrooms-breadcrumb").innerHTML = `설정${BREADCRUMB_CHEVRON}채팅방 참여자 관리`;
  document.getElementById("new-chatroom-btn").onclick = () => openChatroomModal();

  const listEl = document.getElementById("chatroom-list");
  listEl.innerHTML = "<li class='empty-state'>불러오는 중...</li>";

  let rooms;
  try {
    const snap = await getDocs(query(collection(db, "chatRooms"), orderBy("createdAt")));
    rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("채팅방 목록 조회 실패:", e.code, e.message);
    listEl.innerHTML = `<li class='empty-state'>목록을 불러오지 못했습니다: ${e.code || e.message}</li>`;
    return;
  }

  if (rooms.length === 0) {
    listEl.innerHTML = `<li class="empty-state">아직 등록된 채팅방이 없습니다.</li>`;
    return;
  }

  listEl.innerHTML = "";
  rooms.forEach((room) => {
    const li = document.createElement("li");
    li.className = "chatroom-card";
    const avatarsHtml = (room.participants || [])
      .map((key) => libraryData[key])
      .filter(Boolean)
      .map((entry) => `<img src="${entry.src}" alt="" />`)
      .join("");
    li.innerHTML = `
      <div class="chatroom-card-name">${room.name}</div>
      <div class="chatroom-card-bottom-row">
        <div class="chatroom-card-avatars">${avatarsHtml}</div>
        <button type="button" class="chatroom-card-edit-btn" aria-label="채팅방 수정">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>
        </button>
      </div>`;
    li.querySelector(".chatroom-card-edit-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openChatroomModal(room);
    });
    listEl.appendChild(li);
  });
}

// ── 채팅방 추가/수정 모달 ──
const chatroomModal = document.getElementById("chatroom-modal");
const chatroomModalTitle = document.getElementById("chatroom-modal-title");
const chatroomNameInput = document.getElementById("chatroom-name-input");
const chatroomValidationMsg = document.getElementById("chatroom-validation-msg");
const chatroomParticipantsBtn = document.getElementById("chatroom-participants-btn");
const chatroomParticipantsIcon = document.getElementById("chatroom-participants-icon");
const chatroomParticipantsPreview = document.getElementById("chatroom-participants-preview");
const chatroomParticipantsMenu = document.getElementById("chatroom-participants-menu");
let chatroomSelectedKeys = [];
let editingChatroomId = null;

function renderChatroomParticipantsPreview() {
  if (chatroomSelectedKeys.length === 0) {
    chatroomParticipantsIcon.classList.remove("hidden");
    chatroomParticipantsPreview.classList.add("hidden");
    chatroomParticipantsPreview.innerHTML = "";
  } else {
    chatroomParticipantsIcon.classList.add("hidden");
    chatroomParticipantsPreview.classList.remove("hidden");
    chatroomParticipantsPreview.innerHTML = chatroomSelectedKeys
      .map((key) => libraryData[key])
      .filter(Boolean)
      .map((entry) => `<img src="${entry.src}" alt="" />`)
      .join("");
  }
}

function renderChatroomParticipantsMenu() {
  chatroomParticipantsMenu.innerHTML = Object.entries(libraryData)
    .map(([key, entry]) => {
      const name = key.split("|")[0];
      const selected = chatroomSelectedKeys.includes(key);
      return `<button type="button" class="avatar-option${selected ? " selected" : ""}" data-key="${key}" title="${name}"><img src="${entry.src}" alt="${name}" /></button>`;
    })
    .join("");
}

// room을 넘기면 수정 모드로 연다 (카드 기존 값으로 채워두고, 저장 시
// addDoc 대신 updateDoc). 안 넘기면 빈 값으로 새로 추가하는 모드.
function openChatroomModal(room) {
  editingChatroomId = room ? room.id : null;
  chatroomModalTitle.textContent = room ? "채팅방 수정" : "채팅방 추가";
  chatroomNameInput.value = room ? room.name : "";
  chatroomSelectedKeys = room ? [...(room.participants || [])] : [];
  chatroomValidationMsg.textContent = "";
  renderChatroomParticipantsPreview();
  renderChatroomParticipantsMenu();
  chatroomParticipantsMenu.classList.add("hidden");
  chatroomModal.classList.remove("hidden");
}

function closeChatroomModal() {
  chatroomModal.classList.add("hidden");
  chatroomParticipantsMenu.classList.add("hidden");
}

chatroomParticipantsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  renderChatroomParticipantsMenu();
  chatroomParticipantsMenu.classList.toggle("hidden");
});

chatroomParticipantsMenu.addEventListener("click", (e) => {
  const opt = e.target.closest(".avatar-option");
  if (!opt) return;
  const key = opt.dataset.key;
  const idx = chatroomSelectedKeys.indexOf(key);
  if (idx === -1) {
    chatroomSelectedKeys.push(key);
  } else {
    chatroomSelectedKeys.splice(idx, 1);
  }
  opt.classList.toggle("selected");
  renderChatroomParticipantsPreview();
});

document.addEventListener("click", (e) => {
  if (
    !chatroomParticipantsMenu.classList.contains("hidden") &&
    !e.target.closest("#chatroom-participants-btn") &&
    !e.target.closest("#chatroom-participants-menu")
  ) {
    chatroomParticipantsMenu.classList.add("hidden");
  }
});

document.getElementById("chatroom-cancel-btn").addEventListener("click", closeChatroomModal);

document.getElementById("chatroom-save-btn").addEventListener("click", async () => {
  const name = chatroomNameInput.value.trim();
  if (!name || chatroomSelectedKeys.length === 0) {
    chatroomValidationMsg.textContent = "설정하지 않은 사항이 있어요";
    return;
  }
  chatroomValidationMsg.textContent = "";
  try {
    if (editingChatroomId) {
      await updateDoc(doc(adminDb, "chatRooms", editingChatroomId), {
        name,
        participants: chatroomSelectedKeys,
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(collection(adminDb, "chatRooms"), {
        name,
        participants: chatroomSelectedKeys,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    closeChatroomModal();
    renderChatRoomsView();
  } catch (e) {
    console.error("채팅방 저장 실패:", e.code, e.message);
    alert("저장에 실패했습니다: " + (e.code || e.message));
  }
});
