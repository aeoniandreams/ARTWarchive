// 1차/2차 카테고리 정의. label은 화면에 보이는 이름, id는 내부적으로 쓰는 고유 값.
// icon은 icons/ 폴더의 아이콘 이미지 경로.

const sixNames = ["아크투루스", "스피카", "베가", "알페라츠", "폴룩스", "시리우스"];
const sixIds = ["arcturus", "spica", "vega", "alpheratz", "pollux", "sirius"];

function makeSix() {
  return sixNames.map((label, i) => ({ id: sixIds[i], label }));
}

export const CATEGORIES = [
  {
    id: "main_story",
    label: "메인 스토리",
    icon: "icons/main_story.webp",
    subcategories: Array.from({ length: 13 }, (_, i) => ({
      id: `f${i + 1}`,
      label: `${i + 1}F`,
    })),
  },
  {
    id: "diary",
    label: "다이어리",
    icon: "icons/diary.webp",
    subcategories: makeSix(),
  },
  {
    id: "talk",
    label: "톡 보관함",
    icon: "icons/talk.webp",
    subcategories: [
      { id: "daily", label: "일별 기록" },
      { id: "by_card", label: "카드별 기록" },
      { id: "story_key", label: "스토리키 기록" },
      { id: "other_condition", label: "카드 외 조건별 기록" },
      { id: "favor", label: "호감도 기록" },
      { id: "season", label: "시즌 기록" },
    ],
  },
  {
    id: "call",
    label: "전화 기록",
    icon: "icons/call.webp",
    subcategories: makeSix(),
  },
];

export function findCategory(categoryId) {
  return CATEGORIES.find((c) => c.id === categoryId);
}

export function findSubcategory(categoryId, subcategoryId) {
  const cat = findCategory(categoryId);
  if (!cat) return null;
  return cat.subcategories.find((s) => s.id === subcategoryId) || null;
}
