import { Injectable, ApplicationRef, Injector, EmbeddedViewRef, createComponent, EnvironmentInjector } from '@angular/core';
import { CustomAlertSnackbarComponent } from './custom-alert-snackbar.component';
import { CustomAlertData } from './custom-alert-snackbar.component';

@Injectable({
  providedIn: 'root'
})
export class CustomAlertOverlayService {
  private alertContainer: HTMLElement | null = null;
  private activeAlerts: Map<string, any> = new Map();
  private alertCounter = 0;
  private readonly AUTO_DISMISS_DURATION = 6000; // 6 seconds

  constructor(
    private appRef: ApplicationRef,
    private injector: Injector,
    private environmentInjector: EnvironmentInjector
  ) {
    this.createContainer();
  }

  private createContainer(): void {
    if (typeof document === 'undefined') return;
    
    this.alertContainer = document.createElement('div');
    this.alertContainer.className = 'custom-alert-overlay-container';
    this.alertContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: calc(100vw - 40px);
    `;
    
    document.body.appendChild(this.alertContainer);
  }

  showAlert(
    message: string,
    type: 'info' | 'error' | 'warning' | 'success',
    title?: string
  ): string {
    if (typeof document === 'undefined') {
      console.error('Document is not available');
      return '';
    }

    if (!this.alertContainer) {
      this.createContainer();
    }
    if (!this.alertContainer) {
      console.error('Failed to create alert container');
      return '';
    }

    try {
      const alertId = `alert-${++this.alertCounter}`;
      const alertWrapper = document.createElement('div');
      alertWrapper.className = 'custom-alert-wrapper';
      alertWrapper.style.cssText = `
        pointer-events: auto;
        animation: slideInRight 0.3s ease-out;
      `;

      // Create component using modern Angular API
      const componentRef = createComponent(CustomAlertSnackbarComponent, {
        environmentInjector: this.environmentInjector
      });
      
      // Set data BEFORE attaching view
      componentRef.instance.data = {
        title: title,
        message: message,
        type: type
      } as CustomAlertData;

      // Set dismiss callback
      componentRef.instance.dismissCallback = () => {
        this.removeAlert(alertId, alertWrapper, componentRef);
      };

      // Attach to view
      this.appRef.attachView(componentRef.hostView);
      
      // Get DOM element
      const domElem = (componentRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement;
      
      if (!domElem) {
        console.error('Failed to get DOM element from component');
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
        return '';
      }

      alertWrapper.appendChild(domElem);
      this.alertContainer.appendChild(alertWrapper);

      // Trigger change detection
      componentRef.changeDetectorRef.detectChanges();

      // Store reference with timeout for auto-dismiss
      const timeoutId = setTimeout(() => {
        this.removeAlert(alertId, alertWrapper, componentRef);
      }, this.AUTO_DISMISS_DURATION);

      this.activeAlerts.set(alertId, { componentRef, wrapper: alertWrapper, timeoutId });

      return alertId;
    } catch (error) {
      console.error('Error creating alert:', error);
      return '';
    }
  }

  private removeAlert(alertId: string, wrapper: HTMLElement, componentRef: any): void {
    // Clear timeout if it exists
    const alertData = this.activeAlerts.get(alertId);
    if (alertData && alertData.timeoutId) {
      clearTimeout(alertData.timeoutId);
    }

    wrapper.style.animation = 'slideOutRight 0.3s ease-out';
    setTimeout(() => {
      if (this.alertContainer && wrapper.parentNode === this.alertContainer) {
        this.alertContainer.removeChild(wrapper);
      }
      this.appRef.detachView(componentRef.hostView);
      componentRef.destroy();
      this.activeAlerts.delete(alertId);
    }, 300);
  }

  dismissAll(): void {
    this.activeAlerts.forEach((value, key) => {
      this.removeAlert(key, value.wrapper, value.componentRef);
    });
  }
}

