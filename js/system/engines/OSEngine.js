import { WindowEngine } from './WindowEngine.js';
import { InputEngine } from './InputEngine.js';
import { RenderEngine } from './RenderEngine.js';

export class OSEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Core systems
        this.windowEngine = new WindowEngine();
        this.inputEngine = new InputEngine(this.canvas);
        this.renderEngine = new RenderEngine(this.ctx);
        
        // Connect systems
        this.windowEngine.osEngine = this;
        
        // State
        this.isRunning = false;
        
        this.setupEventHandling();
        this.resizeCanvas();
    }
    
    setupEventHandling() {
        // Handle input events
        this.inputEngine.on('mousedown', (data) => this.handleMouseDown(data));
        this.inputEngine.on('mousemove', (data) => this.handleMouseMove(data));
        this.inputEngine.on('mouseup', (data) => this.handleMouseUp(data));
        this.inputEngine.on('click', (data) => this.handleClick(data));
        this.inputEngine.on('keydown', (data) => this.handleKeyDown(data));
        this.inputEngine.on('keyup', (data) => this.handleKeyUp(data));
        
        // Handle window resize
        window.addEventListener('resize', () => this.resizeCanvas());
    }
    
    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        this.windowEngine.setCanvasSize(this.canvas.width, this.canvas.height);
        this.renderEngine.setCanvasSize(this.canvas.width, this.canvas.height);
        this.render();
    }
    
    // Input handling
    handleMouseDown(data) {
        this.windowEngine.handleMouseDown(data.x, data.y);
        this.render();
    }
    
    handleMouseMove(data) {
        if (this.windowEngine.handleMouseMove(data.x, data.y)) {
            this.render();
        }
    }
    
    handleMouseUp(data) {
        this.windowEngine.handleMouseUp();
        this.render();
    }
    
    handleClick(data) {
        this.windowEngine.handleClick(data.x, data.y);
        this.render();
    }
    
    handleKeyDown(data) {
        this.windowEngine.handleKeyDown(data.event);
        this.render();
    }
    
    handleKeyUp(data) {
        this.windowEngine.handleKeyUp(data.event);
        this.render();
    }
    
    // Window management
    createWindow(relX, relY, relWidth, relHeight, title, content = null, options = {}) {
        return this.windowEngine.createWindow(relX, relY, relWidth, relHeight, title, content, options);
    }
    
    // Single render call per frame
    render() {
        const renderStack = this.windowEngine.buildRenderStack();
        this.renderEngine.render(renderStack);
    }
    
    // Main loop
    start() {
        this.isRunning = true;
        this.gameLoop();
    }
    
    stop() {
        this.isRunning = false;
    }
    
    gameLoop() {
        if (!this.isRunning) return;
        
        this.render();
        requestAnimationFrame(() => this.gameLoop());
    }
}