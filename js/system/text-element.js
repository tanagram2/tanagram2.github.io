// /js/system/text-element.js
import { InteractiveElement } from './interactive-element.js';

export class TextElement extends InteractiveElement {
    constructor(x, y, width, height, text, options = {}) {
        super(x, y, width, height);
        this.text = text;
        this.isSelectable = options.selectable || false;
        
        // Theme-aware styling
        this.theme = options.theme || null;
        this.textColor = options.textColor || this.getThemeColor('text.primary');
        this.font = options.font || this.getThemeFont('normal');
        this.textAlign = options.textAlign || 'left';
        this.selectionColor = options.selectionColor || '#b3d4fc';
        
        this.selectionStart = null;
        this.selectionEnd = null;
    }

    getThemeColor(path) {
        if (this.theme) {
            return this.theme.getColor(path);
        }
        return '#000'; // Fallback
    }

    getThemeFont(size) {
        if (this.theme) {
            return this.theme.getFont(size);
        }
        return '1rem Courier New';
    }
    
    draw(ctx) {
        if (!this.isVisible) return;
        
        // Draw selection background if text is selected
        if (this.isSelectable && this.selectionStart !== null && this.selectionEnd !== null) {
            ctx.fillStyle = this.selectionColor;
            ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        }
        
        // Draw text
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = this.textAlign;
        ctx.textBaseline = 'top';
        ctx.fillText(this.text, this.bounds.x, this.bounds.y);
    }
    
    handleClick(x, y) {
        if (super.handleClick(x, y) && this.isSelectable) {
            // Simple selection - in a real implementation, you'd calculate character position
            this.selectionStart = 0;
            this.selectionEnd = this.text.length;
            return true;
        }
        return false;
    }

    setText(newText) {
        this.text = newText;
    }

    setTheme(theme) {
        this.theme = theme;
        this.textColor = this.getThemeColor('text.primary');
        this.font = this.getThemeFont('normal');
    }
}
