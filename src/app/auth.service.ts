import { Injectable } from '@angular/core';

export interface AuthUser {
  uid: string;
  email: string;
  boardKey?: string | null;
}

const STORAGE_KEY = 'palagai_auth';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private _user: AuthUser | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this._user = JSON.parse(raw) as AuthUser;
        }
      } catch {
        this._user = null;
      }
    }
  }

  get user(): AuthUser | null {
    return this._user;
  }

  setUser(user: AuthUser | null) {
    this._user = user;
    if (typeof window !== 'undefined') {
      if (user) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }

  updateBoardKey(boardKey: string) {
    if (!this._user) return;
    const updated: AuthUser = { ...this._user, boardKey };
    this.setUser(updated);
  }
}





























