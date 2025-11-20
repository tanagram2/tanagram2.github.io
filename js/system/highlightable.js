// /js/system/highlightable.js
import { InteractiveElement } from './interactive-element.js';

export class Highlightable extends InteractiveElement {
    constructor(x, y, width, height, onClick) {
        super(x, y, width, height);
        this.onClick = onClick;
        
        // Theme-aware defaults
        this.theme = null;
        this.backgroundColor = this.getThemeColor('surface');
        this.hoverColor = this.getThemeColor('ui.menuHover');
        this.borderColor = this.getThemeColor('primary');
    }

    getThemeColor(path) {
        if (this.theme) {
            return this.theme.getColor(path);
        }
        // Fallback colors
        const fallbacks = {
            'surface': '#fff',
            'ui.menuHover': '#ccc',
            'primary': '#666'
        };
        return fallbacks[path] || '#000';
    }
    
    handleClick(x, y) {
        if (super.handleClick(x, y)) {
            if (this.onClick) this.onClick();
            return true;
        }
        return false;
    }
    
    draw(ctx) {
        if (!this.isVisible) return;
        
        ctx.fillStyle = this.isHovered ? this.hoverColor : this.backgroundColor;
        ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
    }

    setTheme(theme) {
        this.theme = theme;
        this.backgroundColor = this.getThemeColor('surface');
        this.hoverColor = this.getThemeColor('ui.menuHover');
        this.borderColor = this.getThemeColor('primary');
    }
}
