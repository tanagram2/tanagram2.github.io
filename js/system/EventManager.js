export class EventManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.listeners = new Map(); // eventType -> Set of callbacks
        this.mousePosition = { x: 0, y: 0 };
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mousePosition.x = e.clientX - rect.left;
            this.mousePosition.y = e.clientY - rect.top;
            this.dispatch('mousemove', this.mousePosition);
        });

        this.canvas.addEventListener('click', (e) => {
            this.dispatch('click', this.mousePosition);
        });

        this.canvas.addEventListener('mousedown', (e) => {
            this.dispatch('mousedown', this.mousePosition);
        });

        this.canvas.addEventListener('mouseup', (e) => {
            this.dispatch('mouseup', this.mousePosition);
        });

        // Keyboard events
        document.addEventListener('keydown', (e) => {
            this.dispatch('keydown', e);
        });

        document.addEventListener('keyup', (e) => {
            this.dispatch('keyup', e);
        });
    }

    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(callback);
    }

    off(eventType, callback) {
        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).delete(callback);
        }
    }

    dispatch(eventType, data) {
        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).forEach(callback => {
                callback(data);
            });
        }
    }

    getMousePosition() {
        return { ...this.mousePosition };
    }
}