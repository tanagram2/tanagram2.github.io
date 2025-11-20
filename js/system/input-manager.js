// /js/system/input-manager.js
export class InputManager {
    constructor(eventDispatcher) {
        this.eventDispatcher = eventDispatcher;
        this.mouseState = {
            x: 0, y: 0,
            buttons: new Set(),
            isDragging: false,
            dragStart: null,
            currentDrag: null
        };
        
        this.keyboardState = {
            keys: new Set(),
            modifiers: { shift: false, ctrl: false, alt: false, meta: false }
        };
        
        this.setupInputListeners();
    }

    setupInputListeners() {
        // Mouse events
        this.eventDispatcher.addEventListener('mousemove', (event) => {
            this.mouseState.x = event.x;
            this.mouseState.y = event.y;
        });

        this.eventDispatcher.addEventListener('mousedown', (event) => {
            this.mouseState.buttons.add(event.button);
        });

        this.eventDispatcher.addEventListener('mouseup', (event) => {
            this.mouseState.buttons.delete(event.button);
            if (this.mouseState.buttons.size === 0) {
                this.mouseState.isDragging = false;
                this.mouseState.currentDrag = null;
            }
        });

        // Keyboard events
        this.eventDispatcher.addEventListener('keydown', (event) => {
            this.keyboardState.keys.add(event.key);
            this.updateModifiers(event);
        });

        this.eventDispatcher.addEventListener('keyup', (event) => {
            this.keyboardState.keys.delete(event.key);
            this.updateModifiers(event);
        });
    }

    updateModifiers(event) {
        this.keyboardState.modifiers = {
            shift: event.shiftKey,
            ctrl: event.ctrlKey,
            alt: event.altKey,
            meta: event.metaKey
        };
    }

    startDrag(element, data = null) {
        this.mouseState.isDragging = true;
        this.mouseState.dragStart = { x: this.mouseState.x, y: this.mouseState.y };
        this.mouseState.currentDrag = { element, data };
    }

    endDrag() {
        this.mouseState.isDragging = false;
        this.mouseState.currentDrag = null;
    }

    isKeyPressed(key) {
        return this.keyboardState.keys.has(key);
    }

    isMouseButtonPressed(button = 0) {
        return this.mouseState.buttons.has(button);
    }

    getMousePosition() {
        return { x: this.mouseState.x, y: this.mouseState.y };
    }

    getModifiers() {
        return { ...this.keyboardState.modifiers };
    }

    isDragging() {
        return this.mouseState.isDragging;
    }

    getCurrentDrag() {
        return this.mouseState.currentDrag;
    }
}
