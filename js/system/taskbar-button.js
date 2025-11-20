// /js/system/taskbar-button.js - FIXED VERSION
import { Button } from './button.js';

export class TaskbarButton extends Button {
    constructor(x, y, width, height, text, onClick, options = {}) {
        // Merge our taskbar defaults with any provided options
        const taskbarOptions = {
            backgroundColor: '#9e9e9e',  // Gray background
            hoverColor: '#bdbdbd',       // Lighter gray on hover  
            textColor: '#0f0',           // GREEN text
            borderRadius: 5,
            font: '1.2rem Courier New',
            borderColor: '#000',         // Black border
            ...options
        };
        
        // Call parent constructor with merged options
        super(x + width / 2, y + height / 2, width, height, text, onClick, taskbarOptions);
        
        // Adjust positioning
        this.bounds.x = x;
        this.bounds.y = y;
        this.originalX = x + width / 2;
        
        // DEBUG: Log what colors we actually have
        console.log('TaskbarButton colors:', {
            bg: this.backgroundColor,
            hover: this.hoverColor, 
            text: this.textColor,
            border: this.borderColor
        });
    }
}
