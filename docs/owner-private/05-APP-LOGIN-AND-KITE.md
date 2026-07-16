# 05 — App login & Kite (pointers)

## App login (shared gate)
- **File:** `src/app/core/auth/auth.constants.ts`  
- **Check:** `AuthService.login` compares username/password to `AUTH_CREDENTIALS`.  
- **Session key:** `palagai_auth_session` in browser storage.  
- Anyone with the app password can open the UI; they still need **their own** Kite API key/secret/token for trading.

> Credentials stay in that TypeScript file — this doc does **not** duplicate them. Open the file locally when you need the values.

## Kite session
- **Save credentials:** Get Token → API Key + Secret → browser local storage (`KiteCredentialsService`).  
- **Access token:** OAuth redirect or paste manual token (`KiteSessionService`).  
- **Trade Desk / Crude / Order Test** require a Kite session via `kiteSessionGuard`.

## Public IP & redirect copy helper
On Get Token dropdown (reference only — does not change Kite for you):

| Item | Typical value |
|------|----------------|
| Order backend public IP | `168.144.28.89` |
| Prod redirect | `https://palagai.app/dashboard/get-token` |
| Local redirect | `http://localhost:4200/` |

Whitelist the IP in Kite Connect for **order** APIs. Each user uses **their** API app credentials.

## Do not confuse
- App password ≠ Kite password ≠ API secret.  
- Sharing app password ≠ sharing your Zerodha account.
