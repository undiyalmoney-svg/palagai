import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Register Quill fonts properly - 5 custom fonts
// Must be done before Quill editor initialization
if (typeof window !== 'undefined') {
  // Wait for Quill to be available
  const registerFonts = () => {
    const Quill = (window as any).Quill;
    if (Quill && Quill.import) {
      try {
        const Font = Quill.import('formats/font');
        // Set whitelist to only our 5 fonts
        Font.whitelist = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'];
        Quill.register(Font, true);
      } catch (e) {
        console.warn('Quill font registration failed:', e);
      }
    }
  };

  // Try immediately
  registerFonts();
  
  // Also try after a short delay in case Quill loads later
  setTimeout(registerFonts, 100);
  setTimeout(registerFonts, 500);
}

bootstrapApplication(App, appConfig)
  .catch((err) => {
    console.error('Error bootstrapping application:', err);
  });
