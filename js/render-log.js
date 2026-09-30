// 티스토리에서 쓰던 표 -> 대화로그 변환 스크립트를 사이트용으로 이식한 버전.
// 원본과 다른 점:
//   - figure[data-ke-type='table'] 등 티스토리 스킨 전용 선택자를 없애고,
//     렌더링 대상 컨테이너(.log-render) 안의 table을 기준으로 동작하도록 변경.
//   - document 전체가 아니라 특정 컨테이너(root)를 인자로 받아 그 안에서만 동작.
//   - 캐릭터 라이브러리(이름·사진 매칭 표)를 기록마다 넣지 않고, 사이트 전역에
//     하나만 저장해두고 매 기록 렌더링 시 그 라이브러리를 넘겨받아 사용.
//     -> 기록 안의 표는 이제 전부 "대화 표"로 취급 (예전처럼 첫 번째 표를
//        라이브러리로 특별 취급하지 않음).
// 나머지 파싱 규칙(/나레이션, /코드, /접기, /끝, >이름, /표)은 원본 그대로.

const decodeHtml = (html) => {
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
};

const getColor = (cell) => {
  const span = cell.querySelector('span[style*="color"]');
  if (span) return span.style.color;
  if (cell.style && cell.style.color) return cell.style.color;
  return "";
};

function applyImgSize(img, root) {
  if (img.closest(".p-box")) return;
  if (img.closest(".s-fold-btn")) return;
  const container = img.closest(".s-container");
  if (!container) return;
  if (!img.naturalWidth || !img.naturalHeight) return;
  const cw = container.offsetWidth;
  // 이모티콘은 데스크탑에서는 좀 더 작게(25%), 모바일에서는 그대로(35%) 보여준다.
  // 일반 첨부 이미지는 항상 35%로 기존과 동일하다.
  const isEmoticon = img.classList.contains("log-emoticon");
  const isDesktop = document.documentElement.clientWidth > 768;
  const ratio = isEmoticon && isDesktop ? 0.25 : 0.35;
  const target = cw * ratio;
  const figure = img.closest("figure");
  const isLandscape = img.naturalWidth >= img.naturalHeight;
  if (isLandscape) {
    img.style.setProperty("height", target + "px", "important");
    img.style.setProperty("width", "auto", "important");
    img.style.setProperty("max-width", "none", "important");
    if (figure) {
      figure.style.setProperty("display", "inline-block", "important");
      figure.style.setProperty("width", "auto", "important");
    }
  } else {
    img.style.setProperty("width", target + "px", "important");
    img.style.setProperty("height", "auto", "important");
    img.style.setProperty("max-width", "none", "important");
    if (figure) {
      figure.style.setProperty("display", "block", "important");
      figure.style.setProperty("width", target + "px", "important");
    }
  }
}

// 선택지(.s-fold-btn) 라벨에 넣은 이미지는 본문 이미지처럼 컨테이너 전체가
// 아니라, 그 선택지 버튼 자신이 차지하는 너비를 기준으로 크기를 잡는다 —
// 버튼들이 flex로 폭을 나눠 가지므로, 버튼 하나가 좁으면 이미지도 그만큼
// 작아지고 넓으면 커진다.
function applyFoldBtnImgSize(img) {
  const btn = img.closest(".s-fold-btn");
  if (!btn) return;
  if (!img.naturalWidth || !img.naturalHeight) return;
  const bw = btn.offsetWidth;
  const isDesktop = document.documentElement.clientWidth > 768;
  const target = bw * (isDesktop ? 0.55 : 0.8);
  const isLandscape = img.naturalWidth >= img.naturalHeight;
  if (isLandscape) {
    img.style.setProperty("height", target + "px", "important");
    img.style.setProperty("width", "auto", "important");
  } else {
    img.style.setProperty("width", target + "px", "important");
    img.style.setProperty("height", "auto", "important");
  }
  img.style.setProperty("max-width", "none", "important");
}

export function resizeContentImages(root) {
  root.querySelectorAll(".c-talk img").forEach((img) => {
    if (img.closest(".p-box")) return;
    if (img.closest(".s-fold-btn")) return;
    if (img.complete && img.naturalWidth) {
      applyImgSize(img, root);
    } else {
      img.addEventListener("load", () => applyImgSize(img, root));
    }
  });
  root.querySelectorAll(".s-fold-btn img").forEach((img) => {
    if (img.complete && img.naturalWidth) {
      applyFoldBtnImgSize(img);
    } else {
      img.addEventListener("load", () => applyFoldBtnImgSize(img));
    }
  });
}

// 라이브러리 표(1행: 이름, 2행: 이미지) 하나를 파싱해서 {name|color: {src,color}} 객체로 변환.
// 캐릭터 라이브러리 관리 화면에서 저장된 표 HTML을 렌더링용으로 미리 파싱해둘 때 사용.
export function parseLibraryTable(container) {
  const lib = {};
  const table = container.querySelector("table");
  if (!table) return lib;
  const rows = table.querySelectorAll("tr");
  if (rows.length < 2) return lib;

  const names = rows[0].querySelectorAll("td");
  const imgs = rows[1].querySelectorAll("td");
  names.forEach((cell, idx) => {
    const name = cell.innerText.trim();
    const img = imgs[idx] ? imgs[idx].querySelector("img") : null;
    if (name && img) {
      const color = getColor(cell);
      const key = name + "|" + color;
      lib[key] = {
        src: img.getAttribute("data-src") || img.getAttribute("src") || img.src,
        color: color,
      };
    }
  });
  return lib;
}

// root: 대화 로그가 들어있는 컨테이너 엘리먼트 (예: 뷰어 화면의 div)
// lib: parseLibraryTable()로 미리 만들어둔 전역 캐릭터 라이브러리 객체
// options.showAvatars: false로 주면 라이브러리에 사진이 있어도 프로필 사진을 표시하지 않음
//   (이름/내용은 그대로 나오고, 사진이 붙는 레이아웃만 빠짐 — 톡 보관함 외 카테고리용)
export function renderLog(root, lib = {}, options = {}) {
  const showAvatars = options.showAvatars !== false;
  const tables = Array.from(root.querySelectorAll("table"));
  if (tables.length < 1) return;

  tables.forEach((table) => {
    if (table.dataset.done === "true") return;

    // 원하는 표만 실제 표로 유지: 첫 칸이 "/표"
    const firstCell = table.querySelector("tr td");
    if (firstCell && firstCell.innerText.trim() === "/표") {
      firstCell.style.display = "none";
      const target = table.closest("figure") || table;
      target.classList.add("s-keep-table");
      table.dataset.done = "true";
      return;
    }

    const container = document.createElement("div");
    container.className = "s-container";

    let foldContent = null;
    let foldBtnsWrapper = null;
    let justEndedFold = false;
    let foldStack = [];
    let foldWrapperMap = new WeakMap();

    table.querySelectorAll("tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      if (cells.length < 2) return;

      const rawName = cells[0].innerText.trim();
      const nameColor = getColor(cells[0]);
      const textAlign = cells[1].style.textAlign || "";
      let content = cells[1].innerHTML.replace(/data-src=/g, "src=");

      if (rawName === "/접기") {
        const hasImg = cells[1].querySelector("img");
        const btn = document.createElement("button");
        btn.className = "s-fold-btn";
        if (hasImg) {
          btn.innerHTML = cells[1].innerHTML.replace(/data-src=/g, "src=");
        } else {
          btn.textContent = cells[1].innerText.trim() || "내용 보기";
        }

        const currentParent = foldContent || container;
        const newFoldContent = document.createElement("div");
        newFoldContent.className = "s-fold-content";

        foldStack.push({ foldContent });

        const lastWrapper = foldWrapperMap.get(currentParent);
        if (!justEndedFold || !lastWrapper) {
          foldBtnsWrapper = document.createElement("div");
          foldBtnsWrapper.className = "s-fold-btns";
          currentParent.appendChild(foldBtnsWrapper);
          foldWrapperMap.set(currentParent, foldBtnsWrapper);
        } else {
          foldBtnsWrapper = lastWrapper;
        }
        foldBtnsWrapper.appendChild(btn);
        currentParent.appendChild(newFoldContent);
        foldContent = newFoldContent;

        const thisContent = foldContent;
        const thisWrapper = foldBtnsWrapper;
        btn.addEventListener("click", () => {
          const isOpen = thisContent.classList.contains("open");
          if (isOpen) {
            // 지금 실제로 보이는 높이에서 0으로 줄어드는 게 보이도록, 먼저 현재
            // scrollHeight를 그대로 고정시킨 다음(강제 리플로우로 그 값을
            // 브라우저가 실제로 반영하게 하고) 0으로 낮춰서 트랜지션을 건다.
            thisContent.style.maxHeight = thisContent.scrollHeight + "px";
            void thisContent.offsetHeight;
            thisContent.style.maxHeight = "0px";
            thisContent.classList.remove("open");
            btn.classList.remove("open");
            thisWrapper.classList.remove("has-open");
          } else {
            const anyOpen = thisWrapper.querySelector(".s-fold-btn.open");
            if (!anyOpen) {
              thisContent.classList.add("open");
              btn.classList.add("open");
              thisWrapper.classList.add("has-open");
              thisContent.style.maxHeight = thisContent.scrollHeight + "px";
              // 이미지가 늦게 로드되거나 리사이즈되면 높이가 바뀌는데, 그때도
              // max-height를 다시 재서 내용이 잘리지 않게 한다.
              setTimeout(() => {
                resizeContentImages(root);
                if (thisContent.classList.contains("open")) {
                  thisContent.style.maxHeight = thisContent.scrollHeight + "px";
                }
              }, 50);
            }
          }
        });

        justEndedFold = false;
        return;
      }

      if (rawName === "/끝") {
        const prev = foldStack.pop();
        foldContent = prev ? prev.foldContent : null;
        justEndedFold = true;
        return;
      }

      justEndedFold = false;

      const isRight = rawName.startsWith(">");
      const name = isRight ? rawName.slice(1) : rawName;
      const key = name + "|" + nameColor;
      const entry = showAvatars ? lib[key] : undefined;
      const nameColorStyle = nameColor ? ` style="color:${nameColor}"` : "";

      const row = document.createElement("div");

      if (name === "/코드") {
        row.className = "s-row is-code";
        row.innerHTML = decodeHtml(content);
      } else if (name === "" || name === "/나레이션") {
        row.className = "s-row is-narration";
        if (textAlign) row.style.textAlign = textAlign;
        row.innerHTML = `<div class="c-talk">${content}</div>`;
      } else if (isRight) {
        row.className = "s-row is-right";
        row.innerHTML = `
                    <div class="t-area">
                        <div class="c-talk">${content}</div>
                    </div>
                    ${entry ? `<div class="p-box"><img src="${entry.src}"></div>` : ""}`;
      } else if (entry) {
        row.className = "s-row has-p";
        row.innerHTML = `
                    <div class="p-box"><img src="${entry.src}"></div>
                    <div class="t-area">
                        <div class="c-name"${nameColorStyle}>${name}</div>
                        <div class="c-talk">${content}</div>
                    </div>`;
      } else {
        row.className = "s-row no-p";
        row.innerHTML = `<div class="c-name"${nameColorStyle}>${name}</div><div class="c-talk">${content}</div>`;
      }

      (foldContent || container).appendChild(row);
    });

    const target = table.closest("figure") || table;
    target.parentNode.insertBefore(container, target);
    table.dataset.done = "true";
    target.style.display = "none";
  });

  // 표 한 칸 안에서 엔터로 줄바꿈하면 <p>/<div>가 아니라 <br> 하나로 저장되는데,
  // <br>은 display/line-height를 아무리 줘도 브라우저가 무시해서 CSS만으로는
  // 줄 사이 간격을 늘릴 수 없다(실제로 여러 방법을 테스트해서 확인함). 그래서
  // <br> 기준으로 내용을 잘라 각각 <p>로 감싸고, .c-talk p + p 규칙이 그 사이에만
  // margin을 주게 한다 — 화면 너비에 따라 저절로 꺾이는 자동 줄바꿈은 그대로 <p>
  // 하나 안에 있어서 영향받지 않는다.
  root.querySelectorAll(".c-talk").forEach((el) => {
    if (!el.querySelector("br")) return;
    const groups = [[]];
    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeName === "BR") {
        groups.push([]);
      } else {
        groups[groups.length - 1].push(node);
      }
    });
    el.innerHTML = "";
    groups.forEach((group) => {
      const p = document.createElement("p");
      group.forEach((node) => p.appendChild(node));
      el.appendChild(p);
    });
  });

  resizeContentImages(root);
}
