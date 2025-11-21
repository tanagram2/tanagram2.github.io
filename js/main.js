import { EventManager } from './system/EventManager.js';
import { RenderManager } from './system/RenderManager.js';
import { ZIndexManager } from './system/ZIndexManager.js';
import { InteractiveManager } from './system/InteractiveManager.js';
import { Rect } from './system/Rect.js';
import { RoundedRect } from './system/RoundedRect.js';

class MartianOS {
    constructor() {
        this.canvas = document.getElementById('martian-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Initialize core systems
        this.eventManager = new EventManager(this.canvas);
        this.zIndexManager = new ZIndexManager();
        this.interactiveManager = new InteractiveManager(this.eventManager, this.zIndexManager);
        this.renderManager = new RenderManager(this.ctx);
        
        // Initialize properties first
        this.loadingComplete = false;
        this.loadingProgressValue = 0;
        this.loadingBarBg = null;
        this.loadingProgress = null;
        this.testSquare = null;
        this.yellowSquare = null;
        
        // Create background first (before any methods that use it)
        this.background = new Rect(0, 0, this.canvas.width, this.canvas.height, '#000000');
        
        // Set canvas size and setup loading screen
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.setupLoadingScreen();
        
        this.animate();
    }
    
    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Update background to fill entire canvas
        if (this.background) {
            this.background.width = this.canvas.width;
            this.background.height = this.canvas.height;
        }
        
        // Update loading bar dimensions (relative to canvas size)
        if (this.loadingBarBg && this.loadingProgress) {
            const margin = this.canvas.width * 0.3; // 30% margin
            const barWidth = this.canvas.width * 0.4; // 40% of screen width
            const barHeight = this.canvas.height * 0.02; // 2% of screen height
            const barY = this.canvas.height * 0.5; // 50% from top
            
            this.loadingBarBg.x = margin;
            this.loadingBarBg.y = barY - barHeight / 2;
            this.loadingBarBg.width = barWidth;
            this.loadingBarBg.height = barHeight;
            
            this.loadingProgress.x = margin;
            this.loadingProgress.y = barY - barHeight / 2;
            this.loadingProgress.height = barHeight;
            // Width updates during loading animation
        }
        
        // Update squares positions and sizes (relative to canvas size)
        if (this.testSquare && this.yellowSquare) {
            const squareSize = Math.min(this.canvas.width, this.canvas.height) * 0.1; // 10% of smaller dimension
            const gap = squareSize * 0.2; // 20% of square size as gap
            const totalWidth = squareSize * 2 + gap;
            const x1 = (this.canvas.width - totalWidth) / 2;
            const y = (this.canvas.height - squareSize) / 2;
            const x2 = x1 + squareSize + gap;
            
            this.testSquare.x = x1;
            this.testSquare.y = y;
            this.testSquare.width = squareSize;
            this.testSquare.height = squareSize;
            
            this.yellowSquare.x = x2;
            this.yellowSquare.y = y;
            this.yellowSquare.width = squareSize;
            this.yellowSquare.height = squareSize;
        }
        
        this.renderManager.markDirty();
    }
    
    setupLoadingScreen() {
        // Add background
        this.renderManager.add(this.background, 'background');
        
        // Create loading bar with relative dimensions
        const margin = this.canvas.width * 0.3;
        const barWidth = this.canvas.width * 0.4;
        const barHeight = this.canvas.height * 0.02;
        const barY = this.canvas.height * 0.5;
        
        this.loadingBarBg = new Rect(margin, barY - barHeight / 2, barWidth, barHeight, '#333');
        this.loadingProgress = new Rect(margin, barY - barHeight / 2, 0, barHeight, '#ffffff');
        
        this.renderManager.add(this.loadingBarBg, 'ui');
        this.renderManager.add(this.loadingProgress, 'ui');
        
        // Set max loading progress to match bar width
        this.maxLoadingWidth = barWidth;
    }
    
    setupDesktop() {
        // Remove loading elements
        this.renderManager.remove(this.loadingBarBg, 'ui');
        this.renderManager.remove(this.loadingProgress, 'ui');
        
        // Clear references
        this.loadingBarBg = null;
        this.loadingProgress = null;
        
        // Create squares with relative sizes
        const squareSize = Math.min(this.canvas.width, this.canvas.height) * 0.1;
        const gap = squareSize * 0.2;
        const totalWidth = squareSize * 2 + gap;
        const x1 = (this.canvas.width - totalWidth) / 2;
        const y = (this.canvas.height - squareSize) / 2;
        
        this.testSquare = new RoundedRect(x1, y, squareSize, squareSize, squareSize * 0.15, '#ff0000');
        this.testSquare.handleClick = () => {
            if (this.testSquare.color === '#ff0000') {
                this.testSquare.color = '#00ff00';
            } else if (this.testSquare.color === '#00ff00') {
                this.testSquare.color = '#0000ff';
            } else {
                this.testSquare.color = '#ff0000';
            }
            this.renderManager.markDirty();
        };
        
        const x2 = x1 + squareSize + gap;
        this.yellowSquare = new RoundedRect(x2, y, squareSize, squareSize, squareSize * 0.15, '#ffff00');
        this.yellowSquare.handleClick = () => {
            console.log('Yellow square clicked!');
        };
        
        // Register interactive elements
        this.interactiveManager.register(this.testSquare);
        this.interactiveManager.register(this.yellowSquare);
        this.renderManager.add(this.testSquare, 'ui');
        this.renderManager.add(this.yellowSquare, 'ui');
        
        this.loadingComplete = true;
        this.renderManager.markDirty();
    }
    
    updateLoading() {
        if (this.loadingComplete) return;
        
        this.loadingProgressValue += this.canvas.width * 0.002; // Speed relative to screen width
        this.loadingProgress.width = this.loadingProgressValue;
        
        if (this.loadingProgressValue >= this.maxLoadingWidth) {
            this.setupDesktop();
        }
        
        this.renderManager.markDirty();
    }
    
    animate() {
        this.updateLoading();
        this.renderManager.render();
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize when the page loads
window.addEventListener('load', () => {
    new MartianOS();
});