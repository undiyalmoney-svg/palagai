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
  votes?: { [ip: string]: number };
}

export interface UserRecord {
  email: string;
  passwordHash?: string; // SHA-256 hash of the password
  boardKey?: string;
  createdAt: number;
}

@Injectable({
  providedIn: 'root',
})
export class BoardService {
  private usersRef: DatabaseReference;
  private boardsRef: DatabaseReference;

  constructor() {
    this.usersRef = ref(db, 'users');
    this.boardsRef = ref(db, 'boards');
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

  async createUser(email: string, passwordHash: string): Promise<{ uid: string; user: UserRecord }> {
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
    };
    await set(newRef, user);
    return { uid, user };
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
   * Get all boards submitted for competition
   */
  async getCompetitionBoards(): Promise<Array<{ boardKey: string; board: Board }>> {
    console.log('🔍 [BoardService] Fetching all boards from Firebase...');
    try {
      const snapshot = await get(this.boardsRef);
      console.log('📦 [BoardService] Snapshot received:', snapshot.exists() ? 'exists' : 'empty');
      
      if (!snapshot.exists()) {
        console.log('⚠️ [BoardService] No boards found in Firebase');
        return [];
      }

      const boardsData = snapshot.val();
      console.log('📋 [BoardService] Total boards in database:', Object.keys(boardsData).length);
      
      const competitionBoards: Array<{ boardKey: string; board: Board }> = [];

      for (const [boardKey, boardData] of Object.entries(boardsData)) {
        const board = boardData as Board;
        console.log(`  Checking board ${boardKey}:`, {
          isSubmitted: board.isSubmittedForCompetition,
          isSubmittedType: typeof board.isSubmittedForCompetition,
          hasMessage: !!board.message,
          messageHtml: board.message?.html?.substring(0, 50) || 'no message',
          hasVotes: !!board.votes
        });
        
        // Check if board is submitted
        if (board.isSubmittedForCompetition === true) {
          console.log(`  ✅ Board ${boardKey} is submitted for competition`);
          competitionBoards.push({ boardKey, board });
        } else {
          console.log(`  ❌ Board ${boardKey} is NOT submitted (value: ${board.isSubmittedForCompetition})`);
        }
      }

      console.log(`🎯 [BoardService] Found ${competitionBoards.length} competition boards`);
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

    // Check session storage first
    const existingSessionId = sessionStorage.getItem('palagai_session_id');
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
      
      // Store in session for future use
      sessionStorage.setItem('palagai_session_id', ip);
      return ip;
    } catch (error) {
      // Fallback: use a session-based identifier
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('palagai_session_id', sessionId);
      return sessionId;
    }
  }

  /**
   * Check if IP has already voted for a board
   */
  async hasVoted(boardKey: string, ip: string): Promise<boolean> {
    if (!boardKey || !boardKey.trim()) {
      console.log(`⚠️ [BoardService] Invalid boardKey for hasVoted check`);
      return false;
    }

    try {
      console.log(`🔍 [BoardService] Checking if IP ${ip} has voted for board: ${boardKey}`);
      const board = await this.getBoard(boardKey);
      if (!board || !board.votes) {
        console.log(`  No votes object found for board ${boardKey}`);
        return false;
      }

      const hasVoted = board.votes[ip] !== undefined && board.votes[ip] > 0;
      console.log(`  ✅ Has voted check result: ${hasVoted}`, board.votes);
      return hasVoted;
    } catch (err: any) {
      console.error(`❌ [BoardService] Error checking vote for ${boardKey}:`, err);
      return false;
    }
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

      // Get current votes or initialize empty object
      const currentVotes = board.votes || {};
      
      // Check if IP already voted
      if (currentVotes[ip] && currentVotes[ip] > 0) {
        throw new Error('You have already voted for this Kavithai!');
      }

      // Add vote: IP:Count (count is always 1 for a vote)
      const updatedVotes = {
        ...currentVotes,
        [ip]: 1
      };

      // Update board with new votes
      await update(child(this.boardsRef, boardKey.trim()), {
        votes: updatedVotes,
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
   * Get vote count for a board
   */
  async getVoteCount(boardKey: string): Promise<number> {
    if (!boardKey || !boardKey.trim()) {
      return 0;
    }

    try {
      const board = await this.getBoard(boardKey);
      if (!board || !board.votes) {
        return 0;
      }

      // Count all IPs that have voted (count > 0)
      return Object.values(board.votes).reduce((total, count) => total + (count > 0 ? 1 : 0), 0);
    } catch (err: any) {
      console.error('Error getting vote count:', err);
      return 0;
    }
  }

  /**
   * Subscribe to vote count changes for a board
   */
  subscribeToVoteCount(boardKey: string, callback: (count: number) => void): Unsubscribe {
    const boardRef = child(this.boardsRef, boardKey.trim());
    
    const unsubscribe = onValue(boardRef, (snapshot) => {
      if (!snapshot.exists()) {
        callback(0);
        return;
      }
      const board = snapshot.val() as Board;
      if (!board.votes) {
        callback(0);
        return;
      }
      // Count all IPs that have voted
      const count = Object.values(board.votes).reduce((total, voteCount) => total + (voteCount > 0 ? 1 : 0), 0);
      callback(count);
    });

    return unsubscribe;
  }
}


