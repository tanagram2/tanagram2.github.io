// /js/system/taskbar-button.js
import { Button } from './button.js';

export class TaskbarButton extends Button {
    constructor(x, y, width, height, text, onClick, options = {}) {
        const taskbarOptions = {
            backgroundColor: '#00f',        // BLUE background
            hoverColor: '#0000cc',          // Darker blue on hover
            textColor: '#f00',              // RED text
            borderRadius: 5,
            font: '1.2rem Courier New',
            borderColor: '#000',            // Black border
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
        
        console.log('TaskbarButton draw called - colors:', {
            background: this.backgroundColor,
            text: this.textColor,
            hover: this.hoverColor
        });
        
        // Draw background (should be BLUE)
        ctx.fillStyle = this.isHovered ? this.hoverColor : this.backgroundColor;
        if (this.borderRadius > 0) {
            this.drawRoundedRect(ctx, this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height, this.borderRadius);
            ctx.fill();
        } else {
            ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        }
        
        // Draw text (should be RED)
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, this.originalX, this.bounds.y + this.bounds.height / 2);
        
        // Draw border (should be BLACK)
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
