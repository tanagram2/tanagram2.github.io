// /js/system/taskbar-button.js
import { Button } from './button.js';

export class TaskbarButton extends Button {
    constructor(x, y, width, height, text, onClick, options = {}) {
        // NO BACKGROUND - transparent button sitting on taskbar
        const taskbarOptions = {
            backgroundColor: 'transparent',  // No background!
            hoverColor: 'rgba(255, 255, 255, 0.2)', // Subtle hover effect
            textColor: '#0f0',               // Green text
            borderRadius: 5,
            font: '1.2rem Courier New',
            borderColor: '#000',             // Black border
            ...options
        };
        
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        super(centerX, centerY, width, height, text, onClick, taskbarOptions);
        
        this.bounds.x = x;
        this.bounds.y = y;
        this.originalX = x + width / 2;
    }

    draw(ctx) {
        if (!this.isVisible) return;
        
        // Only draw background on hover (subtle highlight)
        if (this.isHovered) {
            ctx.fillStyle = this.hoverColor;
            if (this.borderRadius > 0) {
                this.drawRoundedRect(ctx, this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height, this.borderRadius);
            } else {
                ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
            }
        }
        
        // Draw the green text
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, this.originalX, this.bounds.y + this.bounds.height / 2);
        
        // Draw black border
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = 2;
        if (this.borderRadius > 0) {
            this.drawRoundedRect(ctx, this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height, this.borderRadius);
            ctx.stroke();
        } else {
            ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        }
    }
}
