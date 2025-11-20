// /js/system/taskbar-button.js
import { Button } from './button.js';

export class TaskbarButton extends Button {
    constructor(x, y, width, height, text, onClick, options = {}) {
        // Pass options for taskbar styling
        super(x + width / 2, y + height / 2, width, height, text, onClick, {
            backgroundColor: '#9e9e9e',
            hoverColor: '#bdbdbd', 
            textColor: '#000',
            borderRadius: 5,
            font: '1.2rem Courier New',
            borderColor: '#666',
            ...options // Allow overriding
        });
        
        // Taskbar buttons are positioned by top-left corner, not center
        this.bounds.x = x;
        this.bounds.y = y;
        this.originalX = x + width / 2; // Recalculate text center
    }
}
