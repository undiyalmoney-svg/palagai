/**
 * Password hashing utility using Web Crypto API
 * Uses SHA-256 for hashing passwords before storage
 */

/**
 * Hash a password using SHA-256
 * @param password - Plain text password
 * @returns Promise resolving to hex-encoded hash string
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || !password.trim()) {
    throw new Error('Password cannot be empty');
  }

  // Check if Web Crypto API is available
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API is not available');
  }

  // Convert password to ArrayBuffer
  const encoder = new TextEncoder();
  const data = encoder.encode(password);

  // Hash using SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Verify a password against a stored hash
 * @param password - Plain text password to verify
 * @param storedHash - Stored hash to compare against
 * @returns Promise resolving to true if password matches, false otherwise
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash) {
    return false;
  }

  try {
    const passwordHash = await hashPassword(password);
    return passwordHash === storedHash;
  } catch {
    return false;
  }
}

/**
 * Validate password strength (optional helper)
 * @param password - Password to validate
 * @returns Object with isValid boolean and error message if invalid
 */
export function validatePasswordStrength(password: string): { isValid: boolean; error?: string } {
  if (!password || password.length < 6) {
    return { isValid: false, error: 'Password must be at least 6 characters long' };
  }
  return { isValid: true };
}

/**
 * Validate email format
 * @param email - Email to validate
 * @returns true if email format is valid, false otherwise
 */
export function validateEmail(email: string): boolean {
  if (!email || !email.trim()) {
    return false;
  }
  // Basic email regex pattern
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}






















