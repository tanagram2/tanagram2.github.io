// In /js/system/taskbar-button.js - make M green for debugging
export class TaskbarButton extends Button {
    constructor(x, y, width, height, text, onClick, options = {}) {
        super(x + width / 2, y + height / 2, width, height, text, onClick, {
            backgroundColor: '#9e9e9e',  // Gray background
            hoverColor: '#bdbdbd',       // Lighter gray on hover  
            textColor: '#0f0',           // GREEN text so we can see it!
            borderRadius: 5,
            font: '1.2rem Courier New',
            borderColor: '#000',         // Black border
            ...options
        });
        
        this.bounds.x = x;
        this.bounds.y = y;
        this.originalX = x + width / 2;
    }
}
