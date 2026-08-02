import { Component, PLATFORM_ID, afterNextRender, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { buildKiteChecksum, sanitizeKiteCredential } from '../../../core/utils/sha256.util';
import { extractKiteApiError } from '../../../core/utils/kite-error.util';
import { KiteCredentialsService } from '../../../core/kite/kite-credentials.service';
import { KiteApiService } from '../../../core/kite/kite-api.service';
import { KiteSessionService, KiteSession } from '../../../core/kite/kite-session.service';
import { AuthService } from '../../../core/auth/auth.service';
import {
  captureKiteRequestTokenFromLocation,
  consumeKiteRequestToken,
  stashKiteRequestToken,
} from '../../../core/kite/kite-request-token.util';
import { environment } from '../../../../environments/environment';

const KITE_LOGIN_URL = 'https://kite.zerodha.com/connect/login?v=3&api_key=';

interface CopyOption {
  id: string;
  label: string;
  value: string;
  hint: string;
}

@Component({
  selector: 'app-get-token',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './get-token.component.html',
  styleUrl: './get-token.component.css',
})
export class GetTokenComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly kiteApiService = inject(KiteApiService);
  private readonly kiteCredentialsService = inject(KiteCredentialsService);
  private readonly kiteSessionService = inject(KiteSessionService);
  private readonly authService = inject(AuthService);

  protected readonly isRedirecting = signal(false);
  protected readonly isGeneratingChecksum = signal(false);
  protected readonly isExchangingToken = signal(false);
  protected readonly isSavingCredentials = signal(false);
  protected readonly isEditingCredentials = signal(false);
  protected readonly hasStoredCredentials = signal(false);
  protected readonly hideApiSecret = signal(true);
  protected readonly credentialsSaveMessage = signal('');
  protected readonly checksumResult = signal('');
  protected readonly tokenExchangeResult = signal('');
  protected readonly tokenExchangeError = signal('');
  protected readonly sessionSavedMessage = signal('');
  protected readonly hideAccessToken = signal(true);
  protected readonly autoExchangeNote = signal('');
  protected readonly copyMessage = signal('');
  protected readonly selectedCopyId = signal('redirect-prod');
  protected readonly assignedApiKey = signal('');

  private readonly allCopyOptions: CopyOption[] = [
    {
      id: 'public-ip',
      label: 'Public IP (order backend)',
      value: environment.orderEgressIp || '168.144.28.89',
      hint: 'Whitelist this IP in Kite Connect → API → IP whitelist',
    },
    {
      id: 'redirect-prod',
      label: 'Redirect URL (production)',
      value: 'https://palagai.app/kite-callback',
      hint: 'Add as Redirect URL in Kite developer app (required)',
    },
    {
      id: 'redirect-local',
      label: 'Redirect URL (local)',
      value: 'http://localhost:4200/kite-callback',
      hint: 'Local ng serve — must match Kite app redirect for local tests',
    },
    {
      id: 'redirect-prod-legacy',
      label: 'Redirect URL (legacy get-token)',
      value: 'https://palagai.app/dashboard/get-token',
      hint: 'Old URL still works — prefer /kite-callback',
    },
    {
      id: 'page-url',
      label: 'This page URL',
      value: '',
      hint: 'Current browser address (filled on load)',
    },
  ];

  /** Owner (Devil) sees static IP; customers do not. */
  protected readonly copyOptions = computed(() => {
    const isDevil = this.authService.currentUser()?.role === 'owner';
    return this.allCopyOptions.filter((o) => isDevil || o.id !== 'public-ip');
  });

  protected readonly selectedCopyOption = computed(() => {
    const opts = this.copyOptions();
    const id = this.selectedCopyId();
    const opt = opts.find((o) => o.id === id) ?? opts[0]!;
    if (opt.id === 'page-url') {
      const href =
        isPlatformBrowser(this.platformId) && typeof window !== 'undefined'
          ? (window.location.href.split('?')[0] ?? window.location.origin)
          : 'https://palagai.app/kite-callback';
      return { ...opt, value: href };
    }
    return opt;
  });

  protected readonly isOwner = computed(
    () => this.authService.currentUser()?.role === 'owner',
  );

  protected readonly todaySession = computed(() => {
    const session = this.kiteSessionService.storedSession();
    if (!session || !this.isSessionFromToday(session)) {
      return null;
    }
    return session;
  });

  protected readonly credentialsForm = this.formBuilder.nonNullable.group({
    apiKey: ['', [Validators.required, Validators.pattern(/\S+/)]],
    apiSecret: ['', [Validators.required, Validators.pattern(/\S+/)]],
  });

  protected readonly step1Form = this.formBuilder.nonNullable.group({
    apiKey: ['', [Validators.required, Validators.pattern(/\S+/)]],
  });

  protected readonly step2Form = this.formBuilder.nonNullable.group({
    apiKey: ['', [Validators.required, Validators.pattern(/\S+/)]],
    requestToken: ['', [Validators.required, Validators.pattern(/\S+/)]],
    apiSecret: ['', [Validators.required, Validators.pattern(/\S+/)]],
  });

  protected readonly step3Form = this.formBuilder.nonNullable.group({
    apiKey: ['', [Validators.required, Validators.pattern(/\S+/)]],
    requestToken: ['', [Validators.required, Validators.pattern(/\S+/)]],
    checksum: ['', [Validators.required, Validators.pattern(/\S+/)]],
  });

  /** Local/dev: paste access token without Kite redirect. */
  protected readonly manualTokenForm = this.formBuilder.nonNullable.group({
    apiKey: ['', [Validators.required, Validators.pattern(/\S+/)]],
    accessToken: ['', [Validators.required, Validators.pattern(/\S+/)]],
  });

  protected readonly manualTokenMessage = signal('');
  protected readonly manualTokenError = signal('');
  protected readonly hideManualAccessToken = signal(true);

  constructor() {
    // Browser-only: load DB key → localStorage/UI first, then auto-exchange redirect token.
    afterNextRender(() => {
      void this.bootAndMaybeExchange();
    });
  }

  /** Refresh /me, sync Admin API key into localStorage + forms, then exchange Kite redirect if any. */
  private async bootAndMaybeExchange(): Promise<void> {
    await this.bootCredentials();
    const stored = this.kiteCredentialsService.getCredentials();
    const apiKey = this.assignedApiKey() || stored?.apiKey || '';
    const apiSecret = stored?.apiSecret || '';
    await this.bootstrapFromKiteRedirect(apiKey, apiSecret);
  }

  private async bootCredentials(): Promise<void> {
    await this.authService.refreshMe();
    const u = this.authService.currentUser();
    if (u?.id) {
      // Guarantees scoped localStorage keys before we save / exchange.
      this.kiteCredentialsService.bindSiteUser(u.id);
      this.kiteSessionService.bindSiteUser(u.id);
    }

    const fromAdmin =
      u?.role !== 'owner' ? String(u?.kiteApiKey || '').trim() : '';
    this.assignedApiKey.set(fromAdmin);

    if (u?.role === 'owner') {
      this.selectedCopyId.set('public-ip');
    } else {
      this.selectedCopyId.set('redirect-prod');
    }

    let stored = this.kiteCredentialsService.getCredentials();

    // Admin-assigned key from DB → localStorage (keep existing secret).
    if (fromAdmin && stored?.apiSecret) {
      if (stored.apiKey !== fromAdmin) {
        this.kiteCredentialsService.saveCredentials({
          apiKey: fromAdmin,
          apiSecret: stored.apiSecret,
        });
        stored = this.kiteCredentialsService.getCredentials();
      }
    }

    this.hasStoredCredentials.set(stored !== null);

    if (stored) {
      const apiKey = fromAdmin || stored.apiKey;
      const apiSecret = stored.apiSecret;
      this.credentialsForm.patchValue({ apiKey, apiSecret });
      this.prefillStepForms(apiKey, apiSecret);
      this.manualTokenForm.patchValue({ apiKey });
      this.setCredentialsFormEditable(false);
      this.isEditingCredentials.set(false);
    } else if (fromAdmin) {
      this.credentialsForm.patchValue({ apiKey: fromAdmin, apiSecret: '' });
      this.prefillStepForms(fromAdmin, '');
      this.manualTokenForm.patchValue({ apiKey: fromAdmin });
      this.setCredentialsFormEditable(true);
      this.isEditingCredentials.set(true);
    } else {
      this.setCredentialsFormEditable(true);
      this.isEditingCredentials.set(true);
    }
  }

  protected async onCopySelected(): Promise<void> {
    const value = this.selectedCopyOption().value?.trim();
    if (!value || !isPlatformBrowser(this.platformId)) {
      this.copyMessage.set('Nothing to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      this.copyMessage.set(`Copied: ${value}`);
    } catch {
      this.copyMessage.set('Copy failed — select the value and copy manually.');
    }
  }

  protected onEditCredentials(): void {
    this.isEditingCredentials.set(true);
    this.credentialsSaveMessage.set('');
    this.setCredentialsFormEditable(true);
  }

  protected onCancelEditCredentials(): void {
    const stored = this.kiteCredentialsService.getCredentials();
    if (!stored) {
      return;
    }

    this.credentialsForm.patchValue(stored);
    this.credentialsSaveMessage.set('');
    this.isEditingCredentials.set(false);
    this.setCredentialsFormEditable(false);
  }

  protected onSaveCredentials(): void {
    if (this.credentialsForm.invalid) {
      this.credentialsForm.markAllAsTouched();
      return;
    }

    const { apiKey, apiSecret } = this.credentialsForm.getRawValue();
    this.isSavingCredentials.set(true);
    this.credentialsSaveMessage.set('');

    this.kiteCredentialsService.saveCredentials({ apiKey, apiSecret });
    this.hasStoredCredentials.set(true);
    this.prefillStepForms(apiKey.trim(), apiSecret.trim());
    this.manualTokenForm.patchValue({ apiKey: apiKey.trim() });
    this.isEditingCredentials.set(false);
    this.setCredentialsFormEditable(false);
    this.credentialsSaveMessage.set('API credentials saved locally.');
    this.isSavingCredentials.set(false);
  }

  protected onRedirect(): void {
    if (this.step1Form.invalid) {
      this.step1Form.markAllAsTouched();
      return;
    }

    const apiKey = sanitizeKiteCredential(this.step1Form.controls.apiKey.value);
    this.isRedirecting.set(true);
    window.location.href = `${KITE_LOGIN_URL}${encodeURIComponent(apiKey)}`;
  }

  protected async onGenerateChecksum(): Promise<void> {
    if (this.step2Form.invalid) {
      this.step2Form.markAllAsTouched();
      return;
    }

    const { apiKey, requestToken, apiSecret } = this.step2Form.getRawValue();
    const trimmedApiKey = sanitizeKiteCredential(apiKey);
    const trimmedRequestToken = sanitizeKiteCredential(requestToken);
    const trimmedApiSecret = sanitizeKiteCredential(apiSecret);

    this.isGeneratingChecksum.set(true);
    this.tokenExchangeResult.set('');
    this.tokenExchangeError.set('');

    try {
      const checksum = await buildKiteChecksum(
        trimmedApiKey,
        trimmedRequestToken,
        trimmedApiSecret,
      );
      this.checksumResult.set(checksum);
      this.step3Form.patchValue({
        apiKey: trimmedApiKey,
        requestToken: trimmedRequestToken,
        checksum,
      });
    } catch {
      this.checksumResult.set('');
      this.tokenExchangeError.set('Failed to generate checksum. Please try again.');
    } finally {
      this.isGeneratingChecksum.set(false);
    }
  }

  protected onExchangeToken(): void {
    if (this.step3Form.invalid) {
      this.step3Form.markAllAsTouched();
      return;
    }

    const { apiKey, requestToken, checksum } = this.step3Form.getRawValue();
    const apiSecret =
      sanitizeKiteCredential(this.step2Form.controls.apiSecret.value) ||
      this.kiteCredentialsService.getCredentials()?.apiSecret ||
      '';
    this.exchangeToken(
      sanitizeKiteCredential(apiKey),
      sanitizeKiteCredential(requestToken),
      sanitizeKiteCredential(checksum),
      apiSecret,
    );
  }

  protected onSaveManualAccessToken(): void {
    if (this.manualTokenForm.invalid) {
      this.manualTokenForm.markAllAsTouched();
      return;
    }

    const { apiKey, accessToken } = this.manualTokenForm.getRawValue();
    this.manualTokenMessage.set('');
    this.manualTokenError.set('');

    const saved = this.kiteSessionService.saveManualAccessToken({
      apiKey: sanitizeKiteCredential(apiKey),
      accessToken: sanitizeKiteCredential(accessToken),
    });

    if (!saved) {
      this.manualTokenError.set('Could not save — check API key and access token.');
      return;
    }

    this.manualTokenMessage.set(
      'Access token saved locally. Trade Desk and Order Test are ready — no redirect needed.',
    );
  }

  private async bootstrapFromKiteRedirect(
    apiKey?: string,
    apiSecret?: string,
  ): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    captureKiteRequestTokenFromLocation();
    const queryToken = this.route.snapshot.queryParamMap.get('request_token')?.trim();
    if (queryToken) {
      stashKiteRequestToken(queryToken);
    }

    const requestToken = consumeKiteRequestToken();
    if (!requestToken) {
      return;
    }

    this.step2Form.patchValue({ requestToken });
    this.step3Form.patchValue({ requestToken });
    this.autoExchangeNote.set(
      'Captured request_token from Kite redirect. Exchanging for access token…',
    );

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });

    const key = sanitizeKiteCredential(apiKey ?? '');
    const secret = sanitizeKiteCredential(apiSecret ?? '');
    if (!key || !secret) {
      this.tokenExchangeError.set(
        'Request token captured, but API Key/Secret are not saved yet. Save credentials above, then generate checksum and exchange.',
      );
      this.autoExchangeNote.set('');
      return;
    }

    try {
      this.isGeneratingChecksum.set(true);
      const checksum = await buildKiteChecksum(key, requestToken, secret);
      this.checksumResult.set(checksum);
      this.step2Form.patchValue({
        apiKey: key,
        apiSecret: secret,
        requestToken,
      });
      this.step3Form.patchValue({
        apiKey: key,
        requestToken,
        checksum,
      });
      this.isGeneratingChecksum.set(false);
      this.exchangeToken(key, requestToken, checksum, secret);
    } catch {
      this.isGeneratingChecksum.set(false);
      this.autoExchangeNote.set('');
      this.tokenExchangeError.set('Failed to generate checksum from redirect token.');
    }
  }

  private exchangeToken(
    apiKey: string,
    requestToken: string,
    checksum: string,
    apiSecret: string,
  ): void {
    this.isExchangingToken.set(true);
    this.tokenExchangeResult.set('');
    this.tokenExchangeError.set('');
    this.sessionSavedMessage.set('');

    this.kiteApiService
      .exchangeSessionToken({
        apiKey,
        requestToken,
        checksum,
        apiSecret,
      })
      .subscribe({
        next: (response) => {
          this.tokenExchangeResult.set(JSON.stringify(response, null, 2));
          const siteUser = this.authService.currentUser();
          if (siteUser?.id) {
            this.kiteCredentialsService.bindSiteUser(siteUser.id);
            this.kiteSessionService.bindSiteUser(siteUser.id);
          }
          const saved = this.kiteSessionService.saveFromTokenResponse(response);
          if (saved) {
            const creds = this.kiteCredentialsService.getCredentials();
            const sessionApiKey =
              this.kiteSessionService.getSession()?.data.api_key?.trim() || '';
            if (creds?.apiSecret && sessionApiKey) {
              this.kiteCredentialsService.saveCredentials({
                apiKey: sessionApiKey,
                apiSecret: creds.apiSecret,
              });
              this.hasStoredCredentials.set(true);
              this.prefillStepForms(sessionApiKey, creds.apiSecret);
              this.credentialsForm.patchValue({
                apiKey: sessionApiKey,
                apiSecret: creds.apiSecret,
              });
              this.setCredentialsFormEditable(false);
              this.isEditingCredentials.set(false);
            }
            this.sessionSavedMessage.set(
              'Access token saved locally. Trade Desk / Historical Tester are ready.',
            );
            this.autoExchangeNote.set('Kite login complete.');
          } else {
            this.tokenExchangeError.set(
              'Kite responded but no access_token was found. Check the JSON below.',
            );
            this.autoExchangeNote.set('');
          }
          this.isExchangingToken.set(false);
        },
        error: (error) => {
          const kiteMessage = extractKiteApiError(error, 'session/token');
          let hint = '';
          if (/invalid or has expired|TokenException/i.test(kiteMessage)) {
            hint =
              ' Request tokens are one-time and expire in a few minutes — click Step 1 Login again for a fresh token.';
          } else if (/checksum/i.test(kiteMessage)) {
            hint =
              ' Re-save your API Key and API Secret from the Kite developer console (must be the matching pair), then login again.';
          }
          this.tokenExchangeError.set(`${kiteMessage}.${hint}`.replace(/\.\./g, '.'));
          this.autoExchangeNote.set('');
          this.isExchangingToken.set(false);
        },
      });
  }

  private prefillStepForms(apiKey: string, apiSecret: string): void {
    this.step1Form.patchValue({ apiKey });
    this.step2Form.patchValue({ apiKey, apiSecret });
    this.step3Form.patchValue({ apiKey });
    this.manualTokenForm.patchValue({ apiKey });
  }

  private setCredentialsFormEditable(editable: boolean): void {
    if (editable) {
      this.credentialsForm.enable({ emitEvent: false });
    } else {
      this.credentialsForm.disable({ emitEvent: false });
    }
  }

  protected formatSessionTime(session: KiteSession): string {
    const raw = session.data.login_time ?? session.savedAt;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw;
    }
    return date.toLocaleString();
  }

  private isSessionFromToday(session: KiteSession): boolean {
    const raw = session.data.login_time ?? session.savedAt;
    const sessionDate = new Date(raw);
    if (Number.isNaN(sessionDate.getTime())) {
      return true;
    }
    return sessionDate.toDateString() === new Date().toDateString();
  }
}
