import { Shape } from './Shape.js';

export class Text extends Shape {
    constructor(x, y, content, color = '#000', font = '2% Arial', relativeTo = null) {
        super(x, y, color);
        this.content = content;
        this.font = font;
        this.textAlign = 'left';
        this.textBaseline = 'alphabetic';
        this.relativeTo = relativeTo;
        this.offsetX = x;
        this.offsetY = y;
        
        this.originalFont = font;
        // Store scaling context for window-relative scaling
        this.scalingContext = null;
    }

    draw(ctx) {
        if (!this.visible) return;
        
        let finalX = this.x;
        let finalY = this.y;
        
        if (this.relativeTo) {
            finalX = this.relativeTo.x + this.offsetX;
            finalY = this.relativeTo.y + this.offsetY;
        }

        const scaledFont = this.getScaledFont(ctx);
        
        ctx.fillStyle = this.color;
        ctx.font = scaledFont;
        ctx.textAlign = this.textAlign;
        ctx.textBaseline = this.textBaseline;
        ctx.fillText(this.content, finalX, finalY);
        
        if (this.applyBorderStyles(ctx)) {
            const metrics = ctx.measureText(this.content);
            const textWidth = metrics.width;
            const textHeight = this.getFontSize(scaledFont);
            
            let borderX = finalX;
            if (this.textAlign === 'center') borderX = finalX - textWidth / 2;
            else if (this.textAlign === 'right') borderX = finalX - textWidth;
            
            let borderY = finalY;
            if (this.textBaseline === 'middle') borderY = finalY - textHeight / 2;
            else if (this.textBaseline === 'bottom') borderY = finalY - textHeight;
            else if (this.textBaseline === 'top') borderY = finalY;
            else borderY = finalY - textHeight * 0.8;
            
            ctx.strokeRect(borderX, borderY, textWidth, textHeight);
        }
    }
    
    getScaledFont(ctx) {
        const fontParts = this.originalFont.split(' ');
        let fontSizePart = fontParts[0];
        const fontFamily = fontParts.slice(1).join(' ');
        
        // UPDATED: Scale based on geometric mean of window content area
        let referenceSize;
        if (this.scalingContext && this.scalingContext.contentWidth && this.scalingContext.contentHeight) {
            // Use geometric mean of width and height for balanced scaling
            referenceSize = Math.sqrt(this.scalingContext.contentWidth * this.scalingContext.contentHeight);
        } else {
            // Fallback: scale relative to canvas diagonal
            referenceSize = ctx.canvas ? Math.sqrt(ctx.canvas.width * ctx.canvas.height) : 600;
        }
        
        if (fontSizePart.includes('%')) {
            const percent = parseFloat(fontSizePart) / 100;
            // REMOVED minimum constraint - let it scale freely
            const scaledSize = percent * referenceSize;
            return `${scaledSize}px ${fontFamily}`;
        }
        else if (fontSizePart.includes('px')) {
            const baseSize = parseFloat(fontSizePart);
            // Scale based on reference size (600px diagonal as reference)
            const scaleFactor = referenceSize / 600;
            // REMOVED minimum constraint - let it scale freely
            const scaledSize = baseSize * scaleFactor;
            return `${scaledSize}px ${fontFamily}`;
        }
        
        return this.originalFont;
    }
    
    getFontSize(fontString) {
        const match = fontString.match(/(\d+)px/);
        return match ? parseInt(match[1]) : 16;
    }

    containsPoint(x, y) {
        return false;
    }

    updatePosition() {
        if (this.relativeTo) {
            this.x = this.relativeTo.x + this.offsetX;
            this.y = this.relativeTo.y + this.offsetY;
        }
    }
    
    setScalingContext(contentWidth, contentHeight) {
        this.scalingContext = {
            contentWidth: contentWidth,
            contentHeight: contentHeight
        };
    }
    
    clearScalingContext() {
        this.scalingContext = null;
    }
    
    setRelativeFontSize(percent, fontFamily = 'Arial') {
        this.originalFont = `${percent}% ${fontFamily}`;
        this.font = this.originalFont;
    }
    
    setAbsoluteFontSize(pixels, fontFamily = 'Arial') {
        this.originalFont = `${pixels}px ${fontFamily}`;
        this.font = this.originalFont;
    }
}