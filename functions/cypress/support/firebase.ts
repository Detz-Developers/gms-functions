{/*
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, DatabaseReference, DataSnapshot } from "firebase/database";
import { getAuth, signInWithEmailAndPassword, UserCredential } from "firebase/auth";

// Firebase web config (real data)
const firebaseConfig = {
  apiKey: "AIzaSyB4uksA5X1fQoh9kXjN1R5_Vg66N7Muoos",
  authDomain: "genizest.firebaseapp.com",
  databaseURL: "https://genizest-default-rtdb.firebaseio.com",
  projectId: "genizest",
  storageBucket: "genizest.firebasestorage.app",
  messagingSenderId: "728207587632",
  appId: "1:728207587632:web:2f73ed4c0124d44ceaf0f5",
  measurementId: "G-FC16Z8FS08"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Cypress-friendly login helper
export const login = (email: string, password: string): Promise<UserCredential> => {
  return signInWithEmailAndPassword(auth, email, password);
};

// Database helpers
export const batteryRef = (id: string): DatabaseReference => ref(db, `batteries/${id}`);

export const readBattery = (id: string): Promise<DataSnapshot> => get(batteryRef(id));

export const writeBattery = (id: string, data: any): Promise<void> => set(batteryRef(id), data);
*/}

// support/firebase.ts
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  get,
  DatabaseReference,
  DataSnapshot,
} from "firebase/database";
import { getAuth, signInWithEmailAndPassword, UserCredential } from "firebase/auth";

// Firebase web config (replace with your real data)
const firebaseConfig = {
  apiKey: "AIzaSyB4uksA5X1fQoh9kXjN1R5_Vg66N7Muoos",
  authDomain: "genizest.firebaseapp.com",
  databaseURL: "https://genizest-default-rtdb.firebaseio.com",
  projectId: "genizest",
  storageBucket: "genizest.firebasestorage.app",
  messagingSenderId: "728207587632",
  appId: "1:728207587632:web:2f73ed4c0124d44ceaf0f5",
  measurementId: "G-FC16Z8FS08",
};

// Initialize Firebase app once
export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Cypress-friendly login helper
export const login = (email: string, password: string): Promise<UserCredential> => {
  return signInWithEmailAndPassword(auth, email, password);
};

// Database helpers (generic)
export const getRef = (path: string): DatabaseReference => ref(db, path);

export const readData = (path: string): Promise<DataSnapshot> => get(getRef(path));

export const writeData = (path: string, data: any): Promise<void> => set(getRef(path), data);

// Specific entity helpers
export const batteryRef = (id: string): DatabaseReference => getRef(`batteries/${id}`);
export const generatorRef = (id: string): DatabaseReference => getRef(`generators/${id}`);
export const invoiceRef = (id: string): DatabaseReference => getRef(`invoices/${id}`);
export const shopRef = (id: string): DatabaseReference => getRef(`shops/${id}`);

export const readBattery = (id: string) => readData(`batteries/${id}`);
export const writeBattery = (id: string, data: any) => writeData(`batteries/${id}`, data);

