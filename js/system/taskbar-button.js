import { Button } from './button.js';

export class TaskbarButton extends Button {
    constructor(x, y, width, height, text, onClick, options = {}) {
        super(x + width / 2, y + height / 2, width, height, text, onClick, {
            backgroundColor: '#9e9e9e',
            hoverColor: '#bdbdbd', 
            textColor: '#000',
            borderRadius: 5,
            font: '1.2rem Courier New',
            borderColor: '#666',
            ...options
        });
        
        this.bounds.x = x;
        this.bounds.y = y;
        this.originalX = x + width / 2;
    }
}
