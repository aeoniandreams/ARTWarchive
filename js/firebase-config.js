import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0lQ8r2kNNKdSd4LaAgQMzqU5RmOTdHSg",
  authDomain: "artwarchive.firebaseapp.com",
  projectId: "artwarchive",
  storageBucket: "artwarchive.firebasestorage.app",
  messagingSenderId: "644983781227",
  appId: "1:644983781227:web:9f9774404dce738cc7be2e"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
