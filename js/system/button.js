// /js/system/button.js
import { Highlightable } from './highlightable.js';

export class Button extends Highlightable {
    constructor(x, y, width, height, text, onClick, options = {}) {
        const centeredX = x - width / 2;
        const centeredY = y - height / 2;
        super(centeredX, centeredY, width, height, onClick);
        
        this.text = text;
        this.originalX = x;
        
        // Theme-aware styling
        this.theme = options.theme || null;
        this.backgroundColor = options.backgroundColor || this.getThemeColor('ui.button');
        this.hoverColor = options.hoverColor || this.getThemeColor('ui.buttonHover');
        this.activeColor = options.activeColor || this.getThemeColor('ui.buttonActive');
        this.textColor = options.textColor || this.getThemeColor('text.primary');
        this.font = options.font || this.getThemeFont('normal');
        this.borderRadius = options.borderRadius || this.getThemeBorderRadius('md');
        this.borderColor = options.borderColor || this.getThemeColor('primary');
        
        this.isActive = false;
        this.activeTimeout = null;
    }

    getThemeColor(path) {
        if (this.theme) {
            return this.theme.getColor(path);
        }
        // Fallback colors
        const fallbacks = {
            'ui.button': '#0f0',
            'ui.buttonHover': '#0c0',
            'ui.buttonActive': '#090',
            'text.primary': '#000',
            'primary': '#666'
        };
        return fallbacks[path] || '#000';
    }

    getThemeFont(size) {
        if (this.theme) {
            return this.theme.getFont(size);
        }
        return '1.2rem Courier New';
    }

    getThemeBorderRadius(size) {
        if (this.theme) {
            return this.theme.getBorderRadius(size);
        }
        return 5;
    }

    draw(ctx) {
        if (!this.isVisible) return;
        
        // Use active color if button is being clicked
        const bgColor = this.isActive ? this.activeColor : 
                       this.isHovered ? this.hoverColor : this.backgroundColor;
        
        ctx.fillStyle = bgColor;
        
        // Draw with rounded corners
        if (this.borderRadius > 0) {
            this.drawRoundedRect(ctx, this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height, this.borderRadius);
        } else {
            ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        }
        
        // Draw text
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, this.originalX, this.bounds.y + this.bounds.height / 2);
        
        // Draw border
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = 2;
        if (this.borderRadius > 0) {
            this.drawRoundedRect(ctx, this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height, this.borderRadius);
            ctx.stroke();
        } else {
            ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        }
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    }

    handleClick(x, y) {
        if (super.handleClick(x, y)) {
            // Visual feedback for click
            this.isActive = true;
            if (this.activeTimeout) clearTimeout(this.activeTimeout);
            this.activeTimeout = setTimeout(() => {
                this.isActive = false;
            }, 150);
            
            return true;
        }
        return false;
    }

    setTheme(theme) {
        this.theme = theme;
        // Update colors to use new theme
        this.backgroundColor = this.getThemeColor('ui.button');
        this.hoverColor = this.getThemeColor('ui.buttonHover');
        this.activeColor = this.getThemeColor('ui.buttonActive');
        this.textColor = this.getThemeColor('text.primary');
        this.font = this.getThemeFont('normal');
    }
}
