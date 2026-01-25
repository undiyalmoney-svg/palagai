import { Injectable } from '@angular/core';
import { CustomAlertOverlayService } from './custom-alert-overlay.service';

@Injectable({
  providedIn: 'root'
})
export class AlertService {
  constructor(private overlayService: CustomAlertOverlayService) {}

  private showAlert(
    message: string,
    type: 'info' | 'error' | 'warning' | 'success',
    title?: string
  ): void {
    this.overlayService.showAlert(message, type, title);
  }

  info(message: string, title?: string): void {
    this.showAlert(message, 'info', title || 'Did you know?');
  }

  error(message: string, title?: string): void {
    this.showAlert(message, 'error', title || 'Uh oh, something went wrong');
  }

  warning(message: string, title?: string): void {
    this.showAlert(message, 'warning', title || 'Warning');
  }

  success(message: string, title?: string): void {
    this.showAlert(message, 'success', title || 'Yay! Everything worked!');
  }
}

