// /js/system/text-element.js
import { InteractiveElement } from './interactive-element.js';

export class TextElement extends InteractiveElement {
    constructor(x, y, width, height, text, options = {}) {
        super(x, y, width, height);
        this.text = text;
        this.isSelectable = options.selectable || false;
        this.textColor = options.textColor || '#000';
        this.font = options.font || '1rem Courier New';
        this.textAlign = options.textAlign || 'left';
        this.selectionStart = null;
        this.selectionEnd = null;
    }
    
    draw(ctx) {
        if (!this.isVisible) return;
        
        if (this.isSelectable && this.selectionStart !== null && this.selectionEnd !== null) {
            ctx.fillStyle = '#b3d4fc';
            ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        }
        
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = this.textAlign;
        ctx.textBaseline = 'top';
        ctx.fillText(this.text, this.bounds.x, this.bounds.y);
    }
    
    handleClick(x, y) {
        if (super.handleClick(x, y) && this.isSelectable) {
            this.selectionStart = 0;
            this.selectionEnd = this.text.length;
            return true;
        }
        return false;
    }
}
