import { Injectable } from '@angular/core';
import {
  DatabaseReference,
  child,
  equalTo,
  get,
  off,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  set,
  Unsubscribe,
  update,
} from 'firebase/database';
import { db } from './firebase.config';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface BoardMessage {
  html: string;
  status: 'active' | 'inactive';
  updatedAt: number;
}

export interface Board {
  ownerUid: string;
  userType: string;
  planType: string;
  createdAt: number;
  message: BoardMessage;
  activeDate: string;
  boardProtection?: boolean;
  authorizedMailList?: string[];
  isSubmittedForCompetition?: boolean;
  competitionInterest?: boolean;
  voteCount?: number; // Vote count stored in board for UI
  boardSize?: 'min' | 'normal' | 'max';
  isBlocked?: boolean;
}

export interface UserRecord {
  email: string;
  passwordHash?: string; // SHA-256 hash of the password
  boardKey?: string;
  createdAt: number;
  gender?: string;
  dateOfBirth?: string; // Format: YYYY-MM-DD
  city?: string;
  state?: string;
  country?: string;
  securityQuestion?: string;
  securityAnswerHash?: string; // SHA-256 hash of the security answer
}

export interface VoteRecord {
  ip: string;
  dateTime: string;
  boardId: string;
  timestamp: number;
}

export interface KavithaiVoteDetail {
  ip: string;
  votingTime: string;
  date: string;
  timestamp: number;
}

export interface Kavithai {
  email: string;
  content: string;
  id: string;
  voteCount: number;
  voteDetails: KavithaiVoteDetail[];
  createdAt: number;
  isDuplicate?: boolean; // Flag to mark duplicate email entries
  isInvalid?: boolean; // Flag to mark invalid entries
}

@Injectable({
  providedIn: 'root',
})
export class BoardService {
  private usersRef: DatabaseReference;
  private boardsRef: DatabaseReference;
  private adminRef: DatabaseReference;
  private votesRef: DatabaseReference;
  private kavithaiRef: DatabaseReference;

  constructor() {
    this.usersRef = ref(db, 'users');
    this.boardsRef = ref(db, 'boards');
    this.adminRef = ref(db, 'admin');
    this.votesRef = ref(db, 'votes');
    this.kavithaiRef = ref(db, 'competition/kavithai');
  }

  /**
   * Generate a fancy unique board ID
   * Format: PAL-ABC123-XYZ789 (prefix + 6 chars - 6 chars)
   * Uses crypto.getRandomValues for better randomness and includes timestamp component
   */
  private generateFancyBoardId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed I, O, 0, 1 for clarity
    const prefix = 'PAL';
    
    const getRandomChars = (length: number): string => {
      let result = '';
      // Use crypto.getRandomValues if available for cryptographically secure randomness
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const randomValues = new Uint32Array(length);
        crypto.getRandomValues(randomValues);
        for (let i = 0; i < length; i++) {
          result += chars.charAt(randomValues[i] % chars.length);
        }
      } else {
        // Fallback to Math.random (less secure but works everywhere)
        for (let i = 0; i < length; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      }
      return result;
    };
    
    // Include timestamp component for additional uniqueness (base36 encoding)
    const timestamp = Date.now();
    const timeHash = timestamp.toString(36).toUpperCase().slice(-4); // Last 4 chars of timestamp
    
    // Generate random parts with timestamp embedded
    const part1 = getRandomChars(4); // 4 random chars
    const part2 = getRandomChars(6); // 6 random chars
    
    // Format: PAL-ABC1-TIME-XYZ789 (includes timestamp for uniqueness)
    return `${prefix}-${part1}${timeHash}-${part2}`;
  }

  /**
   * Check if a board ID already exists (with retry logic for network reliability)
   */
  private async boardIdExists(boardId: string, retries = 3): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        const snapshot = await get(child(this.boardsRef, boardId));
        return snapshot.exists();
      } catch (err: any) {
        // If it's the last retry, handle the error
        if (i === retries - 1) {
          // If permission denied or network error, assume it doesn't exist to avoid blocking
          // But log a warning in development
          if (err?.code === 'PERMISSION_DENIED' || err?.code === 'NETWORK_ERROR') {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('Board ID existence check failed, assuming unique:', err);
            }
            return false;
          }
          throw err;
        }
        // Wait a bit before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 50 * (i + 1)));
      }
    }
    return false;
  }

  /**
   * Generate a unique fancy board ID (with robust collision checking)
   */
  private async generateUniqueFancyBoardId(): Promise<string> {
    let attempts = 0;
    const maxAttempts = 20; // Increased attempts
    
    while (attempts < maxAttempts) {
      const boardId = this.generateFancyBoardId();
      const exists = await this.boardIdExists(boardId);
      
      if (!exists) {
        // Double-check: verify it still doesn't exist (race condition protection)
        const stillExists = await this.boardIdExists(boardId);
        if (!stillExists) {
          return boardId;
        }
      }
      
      attempts++;
      // Small delay between attempts to reduce race conditions
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    // Ultimate fallback: use full timestamp + random to guarantee uniqueness
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const getRandomChars = (length: number): string => {
      let result = '';
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const randomValues = new Uint32Array(length);
        crypto.getRandomValues(randomValues);
        for (let i = 0; i < length; i++) {
          result += chars.charAt(randomValues[i] % chars.length);
        }
      } else {
        for (let i = 0; i < length; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      }
      return result;
    };
    
    // Use full timestamp + random for ultimate uniqueness
    const timestamp = Date.now();
    const timeHash = timestamp.toString(36).toUpperCase();
    const randomPart = getRandomChars(8);
    return `PAL-${timeHash}-${randomPart}`;
  }

  /**
   * Find user by email using RTDB query.
   * Note: Ensure you have an index on 'email' in Firebase Console:
   * Database > Rules > Add index: { "users": { ".indexOn": ["email"] } }
   */
  async findUserByEmail(email: string): Promise<{ uid: string; user: UserRecord } | null> {
    if (!email || !email.trim()) {
      return null;
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
      // Method 1: Try using indexed query (fastest if index exists)
      const q = query(this.usersRef, orderByChild('email'), equalTo(normalizedEmail));
      const snapshot = await get(q);
      
      if (snapshot.exists()) {
        let result: { uid: string; user: UserRecord } | null = null;
        snapshot.forEach((childSnap) => {
          if (!result) {
            const userData = childSnap.val() as UserRecord;
            // Double-check email matches (case-insensitive)
            if (userData.email?.toLowerCase() === normalizedEmail) {
              result = {
                uid: childSnap.key as string,
                user: userData,
              };
            }
          }
          return true;
        });
        if (result) {
          return result;
        }
      }
    } catch (err: any) {
      // If index is not defined, fall back to scanning all users
      if (err?.message?.includes('Index not defined') || err?.code === 'PERMISSION_DENIED') {
        // Fall through to fallback method
      } else {
        throw err;
      }
    }

    // Method 2: Fallback - scan all users (slower but works without index)
    try {
      const allUsersSnapshot = await get(this.usersRef);
      if (!allUsersSnapshot.exists()) {
        return null;
      }

      let result: { uid: string; user: UserRecord } | null = null;
      allUsersSnapshot.forEach((childSnap) => {
        if (!result) {
          const userData = childSnap.val() as UserRecord;
          // Case-insensitive email comparison
          if (userData.email?.toLowerCase() === normalizedEmail) {
            result = {
              uid: childSnap.key as string,
              user: userData,
            };
            return true; // Stop iteration
          }
        }
        return false; // Continue iteration
      });

      return result;
    } catch (err: any) {
      // If we can't read users at all, return null (user doesn't exist)
      if (err?.code === 'PERMISSION_DENIED') {
        return null;
      }
      throw err;
    }
  }

  async createUser(
    email: string,
    passwordHash: string,
    additionalData?: {
      gender?: string;
      dateOfBirth?: string;
      city?: string;
      state?: string;
      country?: string;
      securityQuestion?: string;
      securityAnswerHash?: string;
    }
  ): Promise<{ uid: string; user: UserRecord }> {
    if (!email || !email.trim()) {
      throw new Error('Email is required to create user');
    }
    if (!passwordHash || !passwordHash.trim()) {
      throw new Error('Password hash is required to create user');
    }

    // Normalize email to lowercase for consistency
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists before creating (prevent duplicates)
    const existing = await this.findUserByEmail(normalizedEmail);
    if (existing) {
      throw new Error('User with this email already exists');
    }

    // Firebase automatically generates a unique key when using push()
    // The key is a unique identifier (like: -N1234567890abcdef)
    const newRef = push(this.usersRef);
    const uid = newRef.key as string; // This is the auto-generated Firebase key
    
    const user: UserRecord = {
      email: normalizedEmail,
      passwordHash: passwordHash.trim(),
      createdAt: Date.now(),
      ...(additionalData?.gender && { gender: additionalData.gender }),
      ...(additionalData?.dateOfBirth && { dateOfBirth: additionalData.dateOfBirth }),
      ...(additionalData?.city && { city: additionalData.city.trim() }),
      ...(additionalData?.state && { state: additionalData.state.trim() }),
      ...(additionalData?.country && { country: additionalData.country.trim() }),
      ...(additionalData?.securityQuestion && { securityQuestion: additionalData.securityQuestion }),
      ...(additionalData?.securityAnswerHash && { securityAnswerHash: additionalData.securityAnswerHash.trim() }),
    };
    await set(newRef, user);
    return { uid, user };
  }

  /**
   * Update user password hash in RTDB
   */
  async updateUserPassword(uid: string, newPasswordHash: string): Promise<void> {
    if (!uid || !uid.trim()) {
      throw new Error('User ID is required');
    }
    if (!newPasswordHash || !newPasswordHash.trim()) {
      throw new Error('Password hash is required');
    }

    try {
      const userRef = child(this.usersRef, uid);
      await update(userRef, {
        passwordHash: newPasswordHash.trim(),
      });
    } catch (err: any) {
      console.error('[BoardService] Error updating user password:', err);
      throw new Error('Failed to update password. Please try again.');
    }
  }

  async updateUserBoardKey(uid: string, boardKey: string): Promise<void> {
    if (!uid || !uid.trim()) {
      throw new Error('User ID is required');
    }
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board key is required');
    }
    
    try {
      await update(child(this.usersRef, uid.trim()), { boardKey: boardKey.trim() });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to update user board key.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to update user board key: ${err?.message || 'Unknown error'}`);
    }
  }

  async createBoardForUser(uid: string): Promise<{ boardKey: string; board: Board }> {
    if (!uid || !uid.trim()) {
      throw new Error('User ID is required');
    }
    
    try {
      // Check if user already has a board (one board per user)
      const userSnapshot = await get(child(this.usersRef, uid.trim()));
      if (userSnapshot.exists()) {
        const userData = userSnapshot.val() as UserRecord;
        if (userData.boardKey) {
          // User already has a board - return existing board
          const existingBoard = await this.getBoard(userData.boardKey);
          if (existingBoard) {
            return { boardKey: userData.boardKey, board: existingBoard };
          }
          // Board key exists but board not found - continue to create new one
        }
      }
      
      // Generate a fancy unique board ID (format: PAL-ABC123-XYZ789)
      let boardKey = await this.generateUniqueFancyBoardId();
      
      // Final uniqueness check right before creation (race condition protection)
      const finalCheck = await this.boardIdExists(boardKey);
      if (finalCheck) {
        // If somehow it exists, generate a new one with timestamp fallback
        const timestamp = Date.now();
        const timeHash = timestamp.toString(36).toUpperCase();
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const getRandomChars = (length: number): string => {
          let result = '';
          if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const randomValues = new Uint32Array(length);
            crypto.getRandomValues(randomValues);
            for (let i = 0; i < length; i++) {
              result += chars.charAt(randomValues[i] % chars.length);
            }
          } else {
            for (let i = 0; i < length; i++) {
              result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
          }
          return result;
        };
        boardKey = `PAL-${timeHash}-${getRandomChars(8)}`;
      }
      
      const now = Date.now();
      const today = new Date();
      const activeDate = today.toISOString().slice(0, 10);

      const board: Board = {
        ownerUid: uid.trim(),
        userType: 'shop',
        planType: 'free',
        createdAt: now,
        message: {
          html: '<p>Your new Palagai board</p>',
          status: 'active',
          updatedAt: now,
        },
        activeDate,
        boardProtection: false,
        authorizedMailList: [],
      };

      // Use the custom fancy board ID as the key
      // Use set() with error handling to catch any final race conditions
      try {
        await set(child(this.boardsRef, boardKey), board);
      } catch (err: any) {
        // If board already exists (race condition), throw a clear error
        if (err?.code === 'PERMISSION_DENIED') {
          throw new Error('Permission denied. Unable to create board.');
        }
        // If it's a write conflict, regenerate and retry once
        if (err?.message?.includes('exists') || err?.code === 'DATA_STALE') {
          const timestamp = Date.now();
          const timeHash = timestamp.toString(36).toUpperCase();
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          const getRandomChars = (length: number): string => {
            let result = '';
            if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
              const randomValues = new Uint32Array(length);
              crypto.getRandomValues(randomValues);
              for (let i = 0; i < length; i++) {
                result += chars.charAt(randomValues[i] % chars.length);
              }
            } else {
              for (let i = 0; i < length; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
              }
            }
            return result;
          };
          boardKey = `PAL-${timeHash}-${getRandomChars(8)}`;
          await set(child(this.boardsRef, boardKey), board);
        } else {
          throw err;
        }
      }
      await update(child(this.usersRef, uid.trim()), { boardKey });

      return { boardKey, board };
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to create board.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to create board: ${err?.message || 'Unknown error'}`);
    }
  }

  async getBoard(boardKey: string): Promise<Board | null> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }
    
    try {
      const snapshot = await get(child(this.boardsRef, boardKey.trim()));
      if (!snapshot.exists()) {
        return null;
      }
      return snapshot.val() as Board;
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Please check your board ID.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to load board: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Subscribe to real-time board updates
   * @param boardKey The board ID to listen to
   * @param callback Function called whenever the board data changes
   * @returns Unsubscribe function to stop listening
   */
  subscribeToBoardUpdates(
    boardKey: string,
    callback: (board: Board | null) => void
  ): Unsubscribe {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }

    const boardRef = child(this.boardsRef, boardKey.trim());
    
    // Set up real-time listener
    const unsubscribe = onValue(
      boardRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const board = snapshot.val() as Board;
          callback(board);
        } else {
          callback(null);
        }
      },
      (error) => {
        console.error('Error listening to board updates:', error);
        // On error, still call callback with null to indicate failure
        callback(null);
      }
    );

    return unsubscribe;
  }

  async updateBoardMessage(boardKey: string, html: string): Promise<void> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }
    
    try {
      const now = Date.now();
      await update(child(this.boardsRef, boardKey.trim() + '/message'), {
        html: html || '',
        updatedAt: now,
      });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to update board.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to update board: ${err?.message || 'Unknown error'}`);
    }
  }

  async clearBoardMessage(boardKey: string): Promise<void> {
    await this.updateBoardMessage(boardKey, '');
  }

  async updateBoardSize(boardKey: string, size: 'min' | 'normal' | 'max'): Promise<void> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }
    
    try {
      await update(child(this.boardsRef, boardKey.trim()), {
        boardSize: size,
      });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to update board size.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to update board size: ${err?.message || 'Unknown error'}`);
    }
  }

  async updateBoardProtection(boardKey: string, enabled: boolean): Promise<void> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }
    
    try {
      await update(child(this.boardsRef, boardKey.trim()), {
        boardProtection: enabled,
      });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to update board protection.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to update board protection: ${err?.message || 'Unknown error'}`);
    }
  }

  async updateAuthorizedMailList(boardKey: string, emailList: string[]): Promise<void> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }
    
    if (emailList.length > 50) {
      throw new Error('Authorized mail list cannot exceed 50 emails');
    }
    
    try {
      await update(child(this.boardsRef, boardKey.trim()), {
        authorizedMailList: emailList,
      });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to update email list.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to update email list: ${err?.message || 'Unknown error'}`);
    }
  }

  async addEmailToAuthorizedList(boardKey: string, email: string): Promise<void> {
    if (!email || !email.trim()) {
      throw new Error('Email is required');
    }
    
    try {
      const board = await this.getBoard(boardKey);
      if (!board) {
        throw new Error('Board not found');
      }

      const currentList = board.authorizedMailList || [];
      if (currentList.length >= 50) {
        throw new Error('Maximum 50 emails allowed in authorized list');
      }
      
      const normalizedEmail = email.trim().toLowerCase();
      if (currentList.includes(normalizedEmail)) {
        throw new Error('Email already in authorized list');
      }

      const updatedList = [...currentList, normalizedEmail];
      await this.updateAuthorizedMailList(boardKey, updatedList);
    } catch (err: any) {
      if (err.message.includes('Board not found') || err.message.includes('Board ID')) {
        throw err;
      }
      throw new Error(`Failed to add email: ${err?.message || 'Unknown error'}`);
    }
  }

  async removeEmailFromAuthorizedList(boardKey: string, email: string): Promise<void> {
    if (!email || !email.trim()) {
      throw new Error('Email is required');
    }
    
    try {
      const board = await this.getBoard(boardKey);
      if (!board) {
        throw new Error('Board not found');
      }

      const currentList = board.authorizedMailList || [];
      const normalizedEmail = email.trim().toLowerCase();
      const updatedList = currentList.filter((e) => e !== normalizedEmail);
      
      if (updatedList.length === currentList.length) {
        throw new Error('Email not found in authorized list');
      }
      
      await this.updateAuthorizedMailList(boardKey, updatedList);
    } catch (err: any) {
      if (err.message.includes('Board not found') || err.message.includes('Board ID') || err.message.includes('Email not found')) {
        throw err;
      }
      throw new Error(`Failed to remove email: ${err?.message || 'Unknown error'}`);
    }
  }

  async updateCompetitionSubmission(boardKey: string, isSubmitted: boolean): Promise<void> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }
    
    try {
      await update(child(this.boardsRef, boardKey.trim()), {
        isSubmittedForCompetition: isSubmitted,
      });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Please check your board ID.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to update competition submission: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Store competition interest for a user
   */
  async setCompetitionInterest(boardKey: string, isInterested: boolean): Promise<void> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }
    
    try {
      await update(child(this.boardsRef, boardKey.trim()), {
        competitionInterest: isInterested,
      });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Please check your board ID.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to update competition interest: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Get all boards submitted for competition
   */
  async getCompetitionBoards(): Promise<Array<{ boardKey: string; board: Board }>> {
    try {
      const snapshot = await get(this.boardsRef);
      
      if (!snapshot.exists()) {
        return [];
      }

      const boardsData = snapshot.val();
      const competitionBoards: Array<{ boardKey: string; board: Board }> = [];

      // Optimize: Use Object.entries and filter efficiently
      for (const [boardKey, boardData] of Object.entries(boardsData)) {
        const board = boardData as Board;
        
        // Check if board is submitted (fast check)
        if (board.isSubmittedForCompetition === true) {
          competitionBoards.push({ boardKey, board });
        }
      }

      return competitionBoards;
    } catch (err: any) {
      console.error('❌ [BoardService] Error fetching competition boards:', err);
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to fetch competition boards.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to fetch competition boards: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Get user's IP address (client-side only)
   */
  async getUserIP(): Promise<string> {
    if (typeof window === 'undefined') {
      return 'unknown';
    }

    // Obfuscated localStorage key (made to look like analytics)
    const USER_ANALYTICS_ID = 'usr_analytics_id';
    
    // Check localStorage first (using obfuscated key)
    const existingSessionId = localStorage.getItem(USER_ANALYTICS_ID);
    if (existingSessionId) {
      return existingSessionId;
    }

    try {
      // Try to get IP from a public service with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const data = await response.json();
      const ip = data.ip || 'unknown';
      
      // Store in localStorage (using obfuscated key)
      localStorage.setItem(USER_ANALYTICS_ID, ip);
      return ip;
    } catch (error) {
      // Fallback: use a session-based identifier
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(USER_ANALYTICS_ID, sessionId);
      return sessionId;
    }
  }

  /**
   * Check if IP has already voted for a board (deprecated - now allows multiple votes)
   * Kept for backward compatibility but always returns false
   */
  async hasVoted(boardKey: string, ip: string): Promise<boolean> {
    // Always return false to allow unlimited votes
    return false;
  }

  /**
   * Add a vote for a board with IP tracking
   */
  async addVote(boardKey: string, ip: string): Promise<void> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board ID is required');
    }

    try {
      const board = await this.getBoard(boardKey);
      if (!board) {
        throw new Error('Board not found');
      }

      // Generate unique vote ID
      const now = new Date();
      const dateTime = now.toISOString();
      const timestamp = Date.now();
      const voteId = `vote_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create vote record with IP, date, time, and board ID
      const voteRecord: VoteRecord = {
        ip: ip,
        dateTime: dateTime,
        boardId: boardKey.trim(),
        timestamp: timestamp
      };

      // Store vote in separate votes structure (for internal tracking)
      await set(child(this.votesRef, voteId), voteRecord);
      
      // Update vote count in board (for UI display)
      const currentVoteCount = board.voteCount || 0;
      await update(child(this.boardsRef, boardKey.trim()), {
        voteCount: currentVoteCount + 1
      });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to vote.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      if (err?.message) {
        throw err;
      }
      throw new Error(`Failed to add vote: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Get vote count for a board from board data
   */
  async getVoteCount(boardKey: string): Promise<number> {
    if (!boardKey || !boardKey.trim()) {
      return 0;
    }

    try {
      const board = await this.getBoard(boardKey);
      return board?.voteCount || 0;
    } catch (err: any) {
      console.error('Error getting vote count:', err);
      return 0;
    }
  }

  /**
   * Subscribe to vote count changes for a board from board data
   */
  subscribeToVoteCount(boardKey: string, callback: (count: number) => void): Unsubscribe {
    const boardRef = child(this.boardsRef, boardKey.trim());
    
    const unsubscribe = onValue(boardRef, (snapshot) => {
      if (!snapshot.exists()) {
        callback(0);
        return;
      }
      const board = snapshot.val() as Board;
      callback(board?.voteCount || 0);
    });

    return unsubscribe;
  }

  /**
   * Admin: Get admin credentials
   */
  async getAdminCredentials(): Promise<{ username: string; passwordHash: string } | null> {
    try {
      const snapshot = await get(this.adminRef);
      if (!snapshot.exists()) {
        return null;
      }
      return snapshot.val();
    } catch (err: any) {
      console.error('Error fetching admin credentials:', err);
      throw new Error(`Failed to fetch admin credentials: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Admin: Set admin credentials (initial setup)
   */
  async setAdminCredentials(username: string, passwordHash: string): Promise<void> {
    try {
      await set(this.adminRef, {
        username,
        passwordHash,
        createdAt: Date.now()
      });
    } catch (err: any) {
      console.error('Error setting admin credentials:', err);
      throw new Error(`Failed to set admin credentials: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Admin: Get all boards (Promise version - kept for backward compatibility)
   */
  async getAllBoards(): Promise<Array<{ boardKey: string; board: Board; ownerEmail?: string }>> {
    try {
      console.log('[BoardService] Fetching all boards...');
      const boardsSnapshot = await get(this.boardsRef);
      
      if (!boardsSnapshot.exists()) {
        console.log('[BoardService] No boards found in database');
        return [];
      }

      const boardsData = boardsSnapshot.val();
      console.log('[BoardService] Found boards:', Object.keys(boardsData).length);
      
      const usersSnapshot = await get(this.usersRef);
      const usersData = usersSnapshot.exists() ? usersSnapshot.val() : {};
      console.log('[BoardService] Found users:', Object.keys(usersData).length);

      const allBoards: Array<{ boardKey: string; board: Board; ownerEmail?: string }> = [];

      for (const [boardKey, boardData] of Object.entries(boardsData)) {
        try {
          const board = boardData as Board;
          let ownerEmail: string | undefined;

          // Find owner email
          if (board.ownerUid) {
            for (const [uid, userData] of Object.entries(usersData)) {
              const user = userData as UserRecord;
              if (uid === board.ownerUid) {
                ownerEmail = user.email;
                break;
              }
            }
          }

          allBoards.push({ boardKey, board, ownerEmail });
        } catch (e) {
          console.error(`[BoardService] Error processing board ${boardKey}:`, e);
          // Continue with other boards even if one fails
        }
      }

      // Sort by creation date (newest first)
      allBoards.sort((a, b) => (b.board.createdAt || 0) - (a.board.createdAt || 0));

      console.log('[BoardService] Returning', allBoards.length, 'boards');
      return allBoards;
    } catch (err: any) {
      console.error('[BoardService] Error fetching all boards:', err);
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Please check Firebase rules.');
      }
      throw new Error(`Failed to fetch boards: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Admin: Get all boards as Observable (RxJS pattern)
   */
  getAllBoards$(): Observable<Array<{ boardKey: string; board: Board; ownerEmail?: string }>> {
    return from(this.getAllBoards()).pipe(
      catchError((err) => {
        console.error('[BoardService] Error in getAllBoards$:', err);
        return of([]); // Return empty array on error
      })
    );
  }

  /**
   * Admin: Block a board
   */
  async blockBoard(boardKey: string): Promise<void> {
    try {
      await update(child(this.boardsRef, boardKey), {
        isBlocked: true
      });
    } catch (err: any) {
      console.error('Error blocking board:', err);
      throw new Error(`Failed to block board: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Admin: Unblock a board
   */
  async unblockBoard(boardKey: string): Promise<void> {
    try {
      await update(child(this.boardsRef, boardKey), {
        isBlocked: false
      });
    } catch (err: any) {
      console.error('Error unblocking board:', err);
      throw new Error(`Failed to unblock board: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Admin: Delete a board
   */
  async deleteBoard(boardKey: string): Promise<void> {
    try {
      await set(child(this.boardsRef, boardKey), null);
    } catch (err: any) {
      console.error('Error deleting board:', err);
      throw new Error(`Failed to delete board: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Admin: Delete a user by UID
   */
  async deleteUser(uid: string): Promise<void> {
    if (!uid || !uid.trim()) {
      throw new Error('User ID is required to delete user');
    }

    try {
      await set(child(this.usersRef, uid.trim()), null);
      console.log('[BoardService] User deleted from RTDB:', uid);
    } catch (err: any) {
      console.error('Error deleting user:', err);
      throw new Error(`Failed to delete user: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Admin: Delete both user and board (complete account deletion)
   */
  async deleteAccount(boardKey: string, ownerUid: string): Promise<void> {
    if (!boardKey || !boardKey.trim()) {
      throw new Error('Board key is required');
    }
    if (!ownerUid || !ownerUid.trim()) {
      throw new Error('Owner UID is required');
    }

    try {
      console.log('[BoardService] Deleting account - Board:', boardKey, 'User:', ownerUid);
      
      // Delete board first
      await this.deleteBoard(boardKey);
      console.log('[BoardService] Board deleted successfully');
      
      // Delete user
      await this.deleteUser(ownerUid);
      console.log('[BoardService] User deleted successfully');
      
      console.log('[BoardService] Account deletion complete');
    } catch (err: any) {
      console.error('Error deleting account:', err);
      throw new Error(`Failed to delete account: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Generate a unique kavithai ID
   */
  private generateKavithaiId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const prefix = 'KAV';
    
    const getRandomChars = (length: number): string => {
      let result = '';
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const randomValues = new Uint32Array(length);
        crypto.getRandomValues(randomValues);
        for (let i = 0; i < length; i++) {
          result += chars.charAt(randomValues[i] % chars.length);
        }
      } else {
        for (let i = 0; i < length; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      }
      return result;
    };
    
    return `${prefix}-${getRandomChars(6)}-${getRandomChars(6)}`;
  }

  /**
   * Submit a new kavithai entry
   */
  async submitKavithai(email: string, content: string): Promise<string> {
    if (!email || !email.trim()) {
      throw new Error('Email is required');
    }
    if (!content || !content.trim()) {
      throw new Error('Content is required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new Error('Please enter a valid email address');
    }

    try {
      const kavithaiId = this.generateKavithaiId();
      const now = Date.now();
      
      const kavithai: Kavithai = {
        email: email.trim(),
        content: content.trim(),
        id: kavithaiId,
        voteCount: 0,
        voteDetails: [],
        createdAt: now,
      };

      await set(child(this.kavithaiRef, kavithaiId), kavithai);
      return kavithaiId;
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to submit kavithai.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to submit kavithai: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Get all kavithai entries
   */
  async getAllKavithai(): Promise<Kavithai[]> {
    try {
      console.log('Getting kavithai from Firebase reference:', this.kavithaiRef.toString());
      const snapshot = await get(this.kavithaiRef);
      
      console.log('Firebase snapshot exists:', snapshot.exists());
      
      if (!snapshot.exists()) {
        console.log('No kavithai data found in Firebase');
        return [];
      }

      const kavithaiData = snapshot.val();
      console.log('Kavithai data from Firebase:', kavithaiData);
      
      const kavithaiList: Kavithai[] = [];

      for (const [kavithaiId, kavithai] of Object.entries(kavithaiData)) {
        kavithaiList.push(kavithai as Kavithai);
      }

      console.log('Parsed kavithai list:', kavithaiList.length, 'entries');

      // Sort by creation date (newest first)
      kavithaiList.sort((a, b) => b.createdAt - a.createdAt);

      return kavithaiList;
    } catch (err: any) {
      console.error('Error fetching kavithai:', err);
      console.error('Error details:', {
        code: err?.code,
        message: err?.message,
        stack: err?.stack
      });
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to fetch kavithai entries.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw new Error(`Failed to fetch kavithai: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Get a single kavithai by ID
   */
  async getKavithai(kavithaiId: string): Promise<Kavithai | null> {
    if (!kavithaiId || !kavithaiId.trim()) {
      return null;
    }

    try {
      const snapshot = await get(child(this.kavithaiRef, kavithaiId.trim()));
      
      if (!snapshot.exists()) {
        return null;
      }

      return snapshot.val() as Kavithai;
    } catch (err: any) {
      console.error('Error getting kavithai:', err);
      return null;
    }
  }

  /**
   * Add a vote for a kavithai entry
   */
  async addKavithaiVote(kavithaiId: string, ip: string): Promise<void> {
    if (!kavithaiId || !kavithaiId.trim()) {
      throw new Error('Kavithai ID is required');
    }

    try {
      const kavithai = await this.getKavithai(kavithaiId);
      if (!kavithai) {
        throw new Error('Kavithai not found');
      }

      const now = new Date();
      const dateTime = now.toISOString();
      const date = now.toLocaleDateString();
      const timestamp = now.getTime();

      // Increment vote count
      const currentVoteCount = kavithai.voteCount || 0;
      const updatedVoteCount = currentVoteCount + 1;

      await update(child(this.kavithaiRef, kavithaiId.trim()), {
        voteCount: updatedVoteCount,
      });
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to vote.');
      }
      if (err?.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      if (err?.message) {
        throw err;
      }
      throw new Error(`Failed to add vote: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Get vote count for a kavithai entry
   */
  async getKavithaiVoteCount(kavithaiId: string): Promise<number> {
    if (!kavithaiId || !kavithaiId.trim()) {
      return 0;
    }

    try {
      const kavithai = await this.getKavithai(kavithaiId);
      return kavithai?.voteCount || 0;
    } catch (err: any) {
      console.error('Error getting kavithai vote count:', err);
      return 0;
    }
  }

  /**
   * Subscribe to kavithai vote count changes
   */
  subscribeToKavithaiVoteCount(kavithaiId: string, callback: (count: number) => void): Unsubscribe {
    const kavithaiRef = child(this.kavithaiRef, kavithaiId.trim());
    
    const unsubscribe = onValue(kavithaiRef, (snapshot) => {
      if (!snapshot.exists()) {
        callback(0);
        return;
      }
      const kavithai = snapshot.val() as Kavithai;
      callback(kavithai?.voteCount || 0);
    });

    return unsubscribe;
  }

  /**
   * Delete a kavithai entry
   */
  async deleteKavithai(kavithaiId: string): Promise<void> {
    if (!kavithaiId || !kavithaiId.trim()) {
      throw new Error('Kavithai ID is required');
    }

    try {
      await set(child(this.kavithaiRef, kavithaiId.trim()), null);
    } catch (err: any) {
      console.error('Error deleting kavithai:', err);
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to delete kavithai.');
      }
      throw new Error(`Failed to delete kavithai: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Mark kavithai as duplicate email
   */
  async markKavithaiAsDuplicate(kavithaiId: string, isDuplicate: boolean): Promise<void> {
    if (!kavithaiId || !kavithaiId.trim()) {
      throw new Error('Kavithai ID is required');
    }

    try {
      await update(child(this.kavithaiRef, kavithaiId.trim()), {
        isDuplicate: isDuplicate,
      });
    } catch (err: any) {
      console.error('Error marking kavithai as duplicate:', err);
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to update kavithai.');
      }
      throw new Error(`Failed to update kavithai: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Mark kavithai as invalid entry
   */
  async markKavithaiAsInvalid(kavithaiId: string, isInvalid: boolean): Promise<void> {
    if (!kavithaiId || !kavithaiId.trim()) {
      throw new Error('Kavithai ID is required');
    }

    try {
      await update(child(this.kavithaiRef, kavithaiId.trim()), {
        isInvalid: isInvalid,
      });
    } catch (err: any) {
      console.error('Error marking kavithai as invalid:', err);
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to update kavithai.');
      }
      throw new Error(`Failed to update kavithai: ${err?.message || 'Unknown error'}`);
    }
  }

  /**
   * Update kavithai vote count (admin function)
   */
  async updateKavithaiVoteCount(kavithaiId: string, newVoteCount: number): Promise<void> {
    if (!kavithaiId || !kavithaiId.trim()) {
      throw new Error('Kavithai ID is required');
    }

    if (newVoteCount < 0) {
      throw new Error('Vote count cannot be negative');
    }

    try {
      await update(child(this.kavithaiRef, kavithaiId.trim()), {
        voteCount: newVoteCount,
      });
    } catch (err: any) {
      console.error('Error updating kavithai vote count:', err);
      if (err?.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Unable to update vote count.');
      }
      throw new Error(`Failed to update vote count: ${err?.message || 'Unknown error'}`);
    }
  }
}


