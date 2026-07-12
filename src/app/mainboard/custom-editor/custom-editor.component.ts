import { Component, Input, forwardRef, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-custom-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatSelectModule, MatFormFieldModule, MatProgressSpinnerModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CustomEditorComponent), multi: true }],
  templateUrl: './custom-editor.component.html',
  styleUrl: './custom-editor.component.css'
})
export class CustomEditorComponent implements ControlValueAccessor, AfterViewInit {
  @ViewChild('editor') editorRef!: ElementRef<HTMLDivElement>;
  @ViewChild('colorInput') colorInputRef!: ElementRef<HTMLInputElement>;
  @Input() loading: boolean = false;
  
  value: string = '';
  selectedFont = 'Arial';
  selectedHeader = 'p';
  selectedColor = '#000000';
  isBold = false;
  isItalic = false;
  isUnderline = false;
  showColorPresets = false;
  showMicIcons = false;
  isDragging = false;
  private previousFont: string = '';
  private pendingFont: string | null = null;
  private draggedElement: HTMLElement | null = null;

  // Preset colors for quick access
  presetColors = [
    '#000000', '#333333', '#666666', '#999999', '#CCCCCC',
    '#FF0000', '#FF6600', '#FFCC00', '#00FF00', '#00CCFF',
    '#0066FF', '#6600FF', '#FF00FF', '#FF0066', '#FFFFFF'
  ];

  private savedSelection: Range | null = null;

  fonts = [
    { value: 'Arial', label: 'Arial' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Verdana', label: 'Verdana' },
    { value: 'Melon Pop', label: 'Melon Pop' },
    { value: 'LRAVI Regular', label: 'LRAVI Regular' },
    { value: 'Nallur Plain', label: 'Nallur Plain' }
  ];

  micIcons = [
    { name: 'Mic Icon 1', path: '/assets/icons/mic-icon-1.svg' },
    { name: 'Mic Icon 2', path: '/assets/icons/mic-icon-2.svg' },
    { name: 'Mic Icon 3', path: '/assets/icons/mic-icon-3.svg' }
  ];

  onChange = (value: string) => {};
  onTouched = () => {};

  ngAfterViewInit() {
    if (this.value) {
      this.editorRef.nativeElement.innerHTML = this.value;
    }
  }

  // ControlValueAccessor methods
  writeValue(value: string): void {
    this.value = value || '';
    if (this.editorRef) this.editorRef.nativeElement.innerHTML = this.value;
  }
  registerOnChange(fn: any): void { this.onChange = fn; }
  registerOnTouched(fn: any): void { this.onTouched = fn; }

  // Selection Management
  saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      // Only save if the selection is inside the editor
      if (this.editorRef.nativeElement.contains(range.commonAncestorContainer)) {
        this.savedSelection = range.cloneRange();
      }
    }
  }

  private restoreSelection() {
    this.editorRef.nativeElement.focus();
    if (this.savedSelection) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(this.savedSelection);
      }
    }
  }

  // Commands
  execCommand(command: string, value: string | null = null) {
    this.restoreSelection();
    document.execCommand(command, false, value || undefined);
    this.onEditorInput();
    // After execution, update the saved range to the new cursor position
    this.saveSelection();
  }

  setFont(font: string) {
    this.restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      // No selection, apply to current position
      this.execCommand('fontName', font);
      return;
    }
    
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      this.execCommand('fontName', font);
      return;
    }
    
    // Apply font to selected text only
    try {
      const selectedContents = range.extractContents();
      const span = document.createElement('span');
      span.style.fontFamily = font;
      span.appendChild(selectedContents);
      range.insertNode(span);
      
      // Move cursor after the span
      range.setStartAfter(span);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      
      this.onEditorInput();
      this.saveSelection();
    } catch (e) {
      // Fallback to execCommand
      this.execCommand('fontName', font);
    }
  }

  onFontChange(font: string) {
    // Always update selectedFont and apply the font
    this.selectedFont = font;
    this.previousFont = font;
    this.setFont(font);
    this.pendingFont = null;
  }

  onFontOptionClick(font: string) {
    // Handle click on font option - this fires even if it's the same font
    // Store the pending font to apply it when dropdown closes
    this.pendingFont = font;
  }

  onFontDropdownClosed() {
    // When dropdown closes, apply the font if it was clicked (even if same)
    if (this.pendingFont !== null) {
      // Use setTimeout to ensure the selection is restored after dropdown closes
      setTimeout(() => {
        if (this.pendingFont) {
          this.selectedFont = this.pendingFont;
          this.setFont(this.pendingFont);
          this.pendingFont = null;
        }
      }, 0);
    }
  }

  onDropdownOpened() {
    // Save selection when dropdown opens to preserve text selection
    this.saveSelection();
    // Store current font as previous
    this.previousFont = this.selectedFont;
    this.pendingFont = null;
  }

  setHeader(header: string) {
    this.restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      // No selection, apply to current block (existing behavior)
      this.execCommand('formatBlock', header);
      return;
    }
    
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      // No text selected, apply to current block
      if (header === 'p') {
        // For Normal, find the current block and reset its styles
        let container = range.commonAncestorContainer;
        if (container.nodeType === Node.TEXT_NODE) {
          container = container.parentElement!;
        }
        
        const blockTags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        while (container && container !== this.editorRef.nativeElement) {
          const tagName = (container as HTMLElement).tagName?.toLowerCase();
          if (blockTags.includes(tagName)) {
            const htmlEl = container as HTMLElement;
            // Reset to normal text
            htmlEl.style.fontSize = '';
            htmlEl.style.fontWeight = '';
            htmlEl.style.margin = '';
            htmlEl.style.lineHeight = '';
            // Convert heading to paragraph if needed
            if (tagName.startsWith('h')) {
              const p = document.createElement('p');
              p.innerHTML = htmlEl.innerHTML;
              htmlEl.parentNode?.replaceChild(p, htmlEl);
            }
            this.onEditorInput();
            this.saveSelection();
            return;
          }
          container = container.parentElement!;
        }
      } else {
        this.execCommand('formatBlock', header);
      }
      return;
    }
    
    // Apply header style to selected text only
    try {
      const selectedContents = range.extractContents();
      
      if (header === 'p') {
        // Normal text - remove all heading styles from selected content
        // First, create a temporary container to process the content
        const tempDiv = document.createElement('div');
        tempDiv.appendChild(selectedContents);
        
        // Remove heading tags and reset styles
        const headingElements = tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headingElements.forEach(heading => {
          const span = document.createElement('span');
          span.innerHTML = heading.innerHTML;
          // Reset all heading styles
          span.style.fontSize = '';
          span.style.fontWeight = '';
          span.style.margin = '';
          span.style.lineHeight = '';
          heading.parentNode?.replaceChild(span, heading);
        });
        
        // Reset styles on all elements in the selection
        const allElements = tempDiv.querySelectorAll('*');
        allElements.forEach(el => {
          const htmlEl = el as HTMLElement;
          // Remove heading-specific styles
          htmlEl.style.fontSize = '';
          htmlEl.style.fontWeight = '';
          htmlEl.style.margin = '';
          htmlEl.style.lineHeight = '';
        });
        
        // Insert the processed content
        const fragment = document.createDocumentFragment();
        while (tempDiv.firstChild) {
          fragment.appendChild(tempDiv.firstChild);
        }
        range.insertNode(fragment);
        
        // Move cursor to end of inserted content
        range.setStartAfter(fragment.lastChild || range.startContainer);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        // Create heading element
        const headerElement = document.createElement(header);
        
        // Apply header styles inline
        if (header === 'h1') {
          headerElement.style.fontSize = '2em';
          headerElement.style.fontWeight = '600';
          headerElement.style.margin = '16px 0 8px 0';
          headerElement.style.display = 'block';
        } else if (header === 'h2') {
          headerElement.style.fontSize = '1.5em';
          headerElement.style.fontWeight = '600';
          headerElement.style.margin = '16px 0 8px 0';
          headerElement.style.display = 'block';
        } else if (header === 'h3') {
          headerElement.style.fontSize = '1.17em';
          headerElement.style.fontWeight = '600';
          headerElement.style.margin = '16px 0 8px 0';
          headerElement.style.display = 'block';
        }
        
        headerElement.appendChild(selectedContents);
        range.insertNode(headerElement);
        
        // Move cursor after the header element
        range.setStartAfter(headerElement);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      
      this.onEditorInput();
      this.saveSelection();
    } catch (e) {
      // Fallback to execCommand
      this.execCommand('formatBlock', header);
    }
  }

  onHeaderChange(header: string) {
    // Always update selectedHeader and apply the header, even if it's the same
    this.selectedHeader = header;
    this.setHeader(header);
  }

  onColorChange(color: string) {
    this.selectedColor = color;
    this.execCommand('foreColor', color);
  }

  openColorPicker() {
    // Trigger the native color picker
    if (this.colorInputRef) {
      this.colorInputRef.nativeElement.click();
    }
  }

  setPresetColor(color: string) {
    this.selectedColor = color;
    this.execCommand('foreColor', color);
  }

  getCurrentTextColor(): string {
    if (!this.editorRef) return '#000000';
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
        const element = range.commonAncestorContainer.parentElement;
        if (element) {
          const color = window.getComputedStyle(element).color;
          // Convert rgb to hex if needed
          if (color.startsWith('rgb')) {
            const rgb = color.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
              return '#' + rgb.map(x => {
                const hex = parseInt(x).toString(16);
                return hex.length === 1 ? '0' + hex : hex;
              }).join('');
            }
          }
          return color;
        }
      }
    }
    return this.selectedColor;
  }

  toggleBold() { 
    this.execCommand('bold'); 
  }
  toggleItalic() { 
    this.execCommand('italic'); 
  }
  toggleUnderline() { 
    this.execCommand('underline'); 
  }

  setAlignment(align: string) {
    if (typeof document === 'undefined' || !this.editorRef) return;
    
    this.restoreSelection();
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    
    const range = selection.getRangeAt(0);
    
    // Check if selection is collapsed (no text selected)
    if (range.collapsed) {
      // If no selection, find the current block and apply alignment
      let container = range.commonAncestorContainer;
      if (container.nodeType === Node.TEXT_NODE) {
        container = container.parentElement!;
      }
      
      const blockTags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'li'];
      while (container && container !== this.editorRef.nativeElement) {
        const tagName = (container as HTMLElement).tagName?.toLowerCase();
        if (blockTags.includes(tagName)) {
          (container as HTMLElement).style.textAlign = align;
          this.onEditorInput();
          this.saveSelection();
          return;
        }
        container = container.parentElement!;
      }
      return;
    }
    
    // If text is selected, wrap only the selected content
    try {
      // Check if selection spans multiple block elements
      const startContainer = range.startContainer;
      const endContainer = range.endContainer;
      
      let startBlock: HTMLElement | null = null;
      let endBlock: HTMLElement | null = null;
      
      const blockTags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'li'];
      
      // Find start block
      let node: Node | null = startContainer.nodeType === Node.TEXT_NODE ? startContainer.parentElement : startContainer as HTMLElement;
      while (node && node !== this.editorRef.nativeElement) {
        const tagName = (node as HTMLElement).tagName?.toLowerCase();
        if (blockTags.includes(tagName)) {
          startBlock = node as HTMLElement;
          break;
        }
        node = node.parentElement;
      }
      
      // Find end block
      node = endContainer.nodeType === Node.TEXT_NODE ? endContainer.parentElement : endContainer as HTMLElement;
      while (node && node !== this.editorRef.nativeElement) {
        const tagName = (node as HTMLElement).tagName?.toLowerCase();
        if (blockTags.includes(tagName)) {
          endBlock = node as HTMLElement;
          break;
        }
        node = node.parentElement;
      }
      
      // If selection is within a single block, wrap only the selected content
      if (startBlock && startBlock === endBlock) {
        // Check if the selection is the entire block content
        const blockText = startBlock.textContent || '';
        const selectedText = range.toString();
        
        // Check if selection covers the entire block (ignoring whitespace)
        const blockTextTrimmed = blockText.replace(/\s+/g, ' ').trim();
        const selectedTextTrimmed = selectedText.replace(/\s+/g, ' ').trim();
        
        // Check if selection covers the entire block
        const rangeStart = range.startOffset;
        const rangeEnd = range.endOffset;
        const startNode = range.startContainer;
        const endNode = range.endContainer;
        
        // More accurate check: see if selection spans from start to end of block
        const isFullBlock = 
          (startNode === startBlock.firstChild && rangeStart === 0) &&
          (endNode === startBlock.lastChild && rangeEnd >= (endNode.textContent?.length || 0) - 1);
        
        if (isFullBlock || selectedTextTrimmed === blockTextTrimmed) {
          // Selection is entire block, apply alignment to block
          startBlock.style.textAlign = align;
        } else {
          // Selection is partial - wrap only the selected content
          // Extract the selected content first
          const selectedContents = range.extractContents();
          
          // Create a wrapper div for the selected content with alignment
          const alignedDiv = document.createElement('div');
          alignedDiv.style.textAlign = align;
          alignedDiv.style.display = 'block';
          alignedDiv.appendChild(selectedContents);
          
          // Insert the aligned div at the selection point
          range.insertNode(alignedDiv);
          
          // Collapse range to after the inserted div
          range.setStartAfter(alignedDiv);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } else {
        // Selection spans multiple blocks - extract and wrap in a single aligned div
        const selectedContents = range.extractContents();
        const alignedDiv = document.createElement('div');
        alignedDiv.style.textAlign = align;
        alignedDiv.appendChild(selectedContents);
        range.insertNode(alignedDiv);
      }
    } catch (e) {
      // Fallback: use execCommand
      const cmd = align === 'center' ? 'justifyCenter' : align === 'right' ? 'justifyRight' : 'justifyLeft';
      document.execCommand(cmd, false, undefined);
      // Normalize after execCommand
      setTimeout(() => this.normalizeAllAlignments(), 10);
    }
    
    this.onEditorInput();
    this.saveSelection();
  }

  private normalizeAllAlignments() {
    if (typeof document === 'undefined' || !this.editorRef) return;
    
    const editor = this.editorRef.nativeElement;
    const blockElements = editor.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, blockquote, pre, li');
    
    blockElements.forEach((el: Element) => {
      const htmlEl = el as HTMLElement;
      const computedStyle = window.getComputedStyle(htmlEl);
      const computedAlign = computedStyle.textAlign;
      
      // Check if there's already an inline style
      const inlineAlign = htmlEl.style.textAlign;
      
      // Priority: If computed alignment is center/right/justify, ALWAYS save it as inline style
      // This ensures it's preserved when HTML is saved
      if (computedAlign === 'center' || computedAlign === 'right' || computedAlign === 'justify') {
        // Always set as inline style to ensure it's saved in HTML
        htmlEl.style.textAlign = computedAlign;
      }
      // If computed is left/start/initial but inline style says something else, keep inline style
      // (User might have explicitly set left alignment)
      else if (inlineAlign && inlineAlign !== '' && 
               (inlineAlign === 'center' || inlineAlign === 'right' || inlineAlign === 'justify')) {
        // Keep the inline style - it's what the user set
        htmlEl.style.textAlign = inlineAlign;
      }
      // If there's a computed alignment that's not the default, preserve it
      else if (computedAlign && 
          computedAlign !== 'start' && 
          computedAlign !== 'initial' && 
          computedAlign !== 'inherit' &&
          computedAlign !== 'left') {
        // Always set as inline style to ensure it's saved in HTML
        htmlEl.style.textAlign = computedAlign;
      }
    });
  }

  clearFormatting() {
    this.execCommand('removeFormat');
  }

  onEditorInput() {
    // Always normalize alignments before saving to ensure inline styles are preserved
    this.normalizeAllAlignments();
    // Get the HTML and ensure all style attributes are preserved
    this.value = this.editorRef.nativeElement.innerHTML;
    this.onChange(this.value);
  }

  onEditorBlur() {
    // Normalize alignments when editor loses focus to ensure they're saved
    this.normalizeAllAlignments();
    this.saveSelection();
    this.onTouched();
  }

  insertMicIcon(icon: { name: string; path: string }) {
    this.restoreSelection();
    const img = document.createElement('img');
    img.src = icon.path;
    img.alt = icon.name;
    img.style.width = '48px';
    img.style.height = '48px';
    img.style.cursor = 'move';
    img.draggable = true;
    img.setAttribute('contenteditable', 'false');
    img.classList.add('mic-icon');
    
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      this.editorRef.nativeElement.appendChild(img);
    }
    
    this.onEditorInput();
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    if (!event.dataTransfer) return;

    const draggedId = event.dataTransfer.getData('text/html');
    if (draggedId) {
      // Handle image drag
      const draggedElement = document.getElementById(draggedId);
      if (draggedElement) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const dropTarget = range.commonAncestorContainer;
          
          // Remove from old position
          draggedElement.remove();
          
          // Insert at new position
          if (dropTarget.nodeType === Node.TEXT_NODE) {
            const parent = dropTarget.parentElement;
            if (parent) {
              parent.insertBefore(draggedElement, dropTarget);
            }
          } else {
            (dropTarget as HTMLElement).appendChild(draggedElement);
          }
          
          // Update selection
          range.setStartBefore(draggedElement);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          
          this.onEditorInput();
        }
      }
    } else {
      // Handle text drag
      const text = event.dataTransfer.getData('text/plain');
      if (text && this.savedSelection) {
        // Get drop position
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const dropRange = selection.getRangeAt(0);
          
          // Delete original text if it's a move within editor
          if (this.savedSelection && this.editorRef.nativeElement.contains(this.savedSelection.commonAncestorContainer)) {
            this.savedSelection.deleteContents();
          }
          
          // Insert at drop position
          dropRange.deleteContents();
          const textNode = document.createTextNode(text);
          dropRange.insertNode(textNode);
          dropRange.setStartAfter(textNode);
          dropRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(dropRange);
          
          this.savedSelection = null;
          this.onEditorInput();
        }
      }
    }
  }

  onDragStart(event: DragEvent) {
    const target = event.target as HTMLElement;
    
    if (target.tagName === 'IMG' || target.classList.contains('mic-icon')) {
      // Make images draggable
      this.isDragging = true;
      const id = 'drag-' + Date.now();
      target.id = id;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/html', id);
        event.dataTransfer.setDragImage(target, 0, 0);
      }
      this.draggedElement = target;
      target.style.opacity = '0.5';
    } else {
      // Make selected text draggable
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        const selectedText = selection.toString();
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        
        // Check if selection is within editor
        if (this.editorRef.nativeElement.contains(container)) {
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', selectedText);
            // Store range for deletion
            this.savedSelection = range.cloneRange();
          }
        }
      }
    }
  }

  onDragEnd(event: DragEvent) {
    this.isDragging = false;
    if (this.draggedElement) {
      this.draggedElement.style.opacity = '1';
      this.draggedElement = null;
    }
  }
}