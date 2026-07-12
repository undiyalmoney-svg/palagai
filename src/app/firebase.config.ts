// Import Firebase functions
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database"; // <-- needed for RTDB
import { environment } from "../environments/environment";
// import { getAnalytics } from "firebase/analytics";

// Your Firebase project configuration from environment
export const firebaseConfig = environment.firebase;

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize RTDB
export const db = getDatabase(app);

// Optional: initialize analytics
// export const analytics = getAnalytics(app);
