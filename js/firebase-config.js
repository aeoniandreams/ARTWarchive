import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0lQ8r2kNNKdSd4LaAgQMzqU5RmOTdHSg",
  authDomain: "artwarchive.firebaseapp.com",
  projectId: "artwarchive",
  storageBucket: "artwarchive.firebasestorage.app",
  messagingSenderId: "644983781227",
  appId: "1:644983781227:web:9f9774404dce738cc7be2e"
};

// 지인들이 로그인창에서 입력하는 공용 비밀번호 계정. Firebase Authentication에
// 이 이메일로 사용자를 만들어두세요. 읽기 전용 — Firestore 규칙에서 쓰기는
// 아래 관리자 계정에게만 허용합니다.
export const SHARED_LOGIN_EMAIL = "user@gmail.com";

// 관리자 모드 계정. 위 공용 계정과는 별도의 이메일/비밀번호로 Firebase
// Authentication에 따로 만들어두세요. 기록 추가/수정/저장은 전부 이 계정을
// 통해서만 나갑니다. Firestore 규칙 예시:
//
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /{document=**} {
//         allow read: if request.auth != null;
//         allow write: if request.auth != null
//                      && request.auth.token.email == "aeoniandreams@gmail.com";
//       }
//     }
//   }
export const ADMIN_EMAIL = "aeoniandreams@gmail.com";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// 관리자 계정 전용 보조 앱 인스턴스. 공용 계정(auth/db)과 완전히 분리돼 있어서,
// 관리자 모드로 전환하기 전에는 이 세션이 로그인되어 있지 않고, Firestore
// 규칙이 관리자 이메일에게만 쓰기를 허용하는 한 개발자 도구로 저장 함수를
// 직접 호출해도 거부됩니다.
const adminApp = initializeApp(firebaseConfig, "admin");
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);

export async function signInShared(password) {
  await setPersistence(auth, browserLocalPersistence);
  await signInWithEmailAndPassword(auth, SHARED_LOGIN_EMAIL, password);
}

export async function verifyAdminPassword(password) {
  await setPersistence(adminAuth, browserLocalPersistence);
  await signInWithEmailAndPassword(adminAuth, ADMIN_EMAIL, password);
}

export async function logoutAdmin() {
  await signOut(adminAuth);
}

export async function logoutAll() {
  await signOut(auth);
  try {
    await signOut(adminAuth);
  } catch (e) {
    console.error("관리자 세션 로그아웃 실패:", e);
  }
}
