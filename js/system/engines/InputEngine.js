export class InputEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.listeners = {};
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }
    
    getMousePosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
    
    handleMouseDown(e) {
        const pos = this.getMousePosition(e);
        this.emit('mousedown', { x: pos.x, y: pos.y, event: e });
    }
    
    handleMouseMove(e) {
        const pos = this.getMousePosition(e);
        this.emit('mousemove', { x: pos.x, y: pos.y, event: e });
    }
    
    handleMouseUp(e) {
        const pos = this.getMousePosition(e);
        this.emit('mouseup', { x: pos.x, y: pos.y, event: e });
    }
    
    handleClick(e) {
        const pos = this.getMousePosition(e);
        this.emit('click', { x: pos.x, y: pos.y, event: e });
    }
    
    handleKeyDown(e) {
        this.emit('keydown', { event: e });
    }
    
    handleKeyUp(e) {
        this.emit('keyup', { event: e });
    }
    
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }
    
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }
}