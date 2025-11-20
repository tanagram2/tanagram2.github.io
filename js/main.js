// /js/main.js - DEBUG VERSION
import { Button, TaskbarButton, MenuItem, FocusManager } from './system/index.js';

class MartianOS {
    constructor() {
        console.log('MartianOS: Constructor started');
        
        try {
            // Simple setup - skip complex systems for now
            this.canvas = document.getElementById('martian-canvas');
            this.ctx = this.canvas.getContext('2d');
            console.log('MartianOS: Canvas setup complete');
            
            this.currentScreen = 'matrix';
            this.showPowerMenu = false;
            this.showPowerSubmenu = false;
            this.buttons = [];
            this.mouseX = 0;
            this.mouseY = 0;
            
            this.setupCanvas();
            this.setupEventListeners();
            this.animate();
            this.createUI();
            
            console.log('MartianOS: Initialization complete');
        } catch (error) {
            console.error('MartianOS: Initialization failed:', error);
        }
    }

    setupCanvas() {
        console.log('MartianOS: Setting up canvas');
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        console.log(`MartianOS: Canvas resized to ${this.canvas.width}x${this.canvas.height}`);
        this.createUI();
    }

    setupEventListeners() {
        console.log('MartianOS: Setting up event listeners');
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        
        this.buttons.forEach(button => {
            if (button.handleMouseMove) {
                button.handleMouseMove(this.mouseX, this.mouseY);
            }
        });
    }

    handleClick(e) {
        console.log('MartianOS: Click detected');
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (let button of this.buttons) {
            if (button.handleClick && button.handleClick(x, y)) {
                console.log('MartianOS: Button handled click');
                return;
            }
        }

        if (this.currentScreen === 'desktop') {
            if (this.isInPowerButton(x, y)) {
                this.showPowerMenu = !this.showPowerMenu;
                this.showPowerSubmenu = false;
                this.createUI();
            } else if (this.showPowerMenu && !this.isInPowerMenuArea(x, y)) {
                this.showPowerMenu = false;
                this.showPowerSubmenu = false;
                this.createUI();
            }
        }
    }

    createUI() {
        console.log(`MartianOS: Creating UI for screen: ${this.currentScreen}`);
        this.buttons = [];
        
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        switch (this.currentScreen) {
            case 'matrix':
                this.createMatrixUI(centerX, centerY);
                break;
            case 'about':
                this.createAboutUI(centerX, centerY);
                break;
            case 'os':
                this.createOSUI(centerX, centerY);
                break;
            case 'desktop':
                this.createDesktopUI();
                break;
        }
        
        console.log(`MartianOS: Created ${this.buttons.length} buttons`);
    }

    createMatrixUI(centerX, centerY) {
        console.log('MartianOS: Creating Matrix UI');
        try {
            const aboutButton = new Button(
                centerX, centerY + 45, 200, 50, 'About Me',
                () => { 
                    console.log('About Me clicked');
                    this.currentScreen = 'about'; 
                    this.createUI(); 
                }
            );
            
            const enterButton = new Button(
                centerX, centerY + 115, 200, 50, 'ENTER',
                () => { 
                    console.log('ENTER clicked');
                    this.currentScreen = 'os'; 
                    this.createUI(); 
                }
            );
            
            this.buttons.push(aboutButton, enterButton);
            console.log('MartianOS: Matrix UI created successfully');
        } catch (error) {
            console.error('MartianOS: Error creating Matrix UI:', error);
        }
    }

    createAboutUI(centerX, centerY) {
        console.log('MartianOS: Creating About UI');
        const backButton = new Button(
            centerX, centerY + 125, 200, 50, 'Back',
            () => { 
                console.log('Back clicked');
                this.currentScreen = 'matrix'; 
                this.createUI(); 
            }
        );
        
        this.buttons.push(backButton);
    }

    createOSUI(centerX, centerY) {
        console.log('MartianOS: Creating OS UI');
        const startButton = new Button(
            centerX, centerY + 75, 200, 50, 'START',
            () => { 
                console.log('START clicked');
                this.currentScreen = 'desktop'; 
                this.createUI(); 
            },
            { backgroundColor: '#000', textColor: '#fff' }
        );
        
        this.buttons.push(startButton);
    }

    createDesktopUI() {
        console.log('MartianOS: Creating Desktop UI');
        // Simple taskbar button without complex systems
        const powerButton = {
            bounds: { x: 10, y: 5, width: 40, height: 30 },
            text: 'M',
            isHovered: false,
            
            containsPoint(x, y) {
                return x >= this.bounds.x && x <= this.bounds.x + this.bounds.width &&
                       y >= this.bounds.y && y <= this.bounds.y + this.bounds.height;
            },
            
            handleMouseMove(x, y) {
                this.isHovered = this.containsPoint(x, y);
            },
            
            handleClick(x, y) {
                if (this.containsPoint(x, y)) {
                    console.log('Power button clicked');
                    this.showPowerMenu = !this.showPowerMenu;
                    return true;
                }
                return false;
            },
            
            draw(ctx) {
                // Draw button background
                ctx.fillStyle = this.isHovered ? '#bdbdbd' : '#9e9e9e';
                ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
                
                // Draw border
                ctx.strokeStyle = '#666';
                ctx.lineWidth = 2;
                ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
                
                // Draw text
                ctx.fillStyle = '#000';
                ctx.font = '1.2rem Courier New';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.text, this.bounds.x + this.bounds.width / 2, this.bounds.y + this.bounds.height / 2);
            }
        };
        
        this.buttons.push(powerButton);
    }

    animate(currentTime = 0) {
        requestAnimationFrame((time) => this.animate(time));
        this.render();
    }

    render() {
        console.log('MartianOS: Rendering frame');
        try {
            // Clear canvas
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            // Render current screen
            switch (this.currentScreen) {
                case 'matrix':
                    this.renderMatrixScreen();
                    break;
                case 'about':
                    this.renderAboutScreen();
                    break;
                case 'os':
                    this.renderOSScreen();
                    break;
                case 'desktop':
                    this.renderDesktopScreen();
                    break;
            }

            // Render all buttons
            this.buttons.forEach(button => {
                if (button.draw) {
                    button.draw(this.ctx);
                }
            });
            
            console.log('MartianOS: Frame rendered successfully');
        } catch (error) {
            console.error('MartianOS: Error rendering frame:', error);
        }
    }

    renderMatrixScreen() {
        this.ctx.fillStyle = '#0f0';
        this.ctx.font = '2.5rem Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('MartianMatrix', this.canvas.width / 2, this.canvas.height / 2 - 50);
    }

    renderAboutScreen() {
        this.ctx.fillStyle = '#0f0';
        this.ctx.font = '2.5rem Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('About Me', this.canvas.width / 2, this.canvas.height / 2 - 80);

        this.ctx.font = '1rem Courier New';
        this.ctx.fillText('This is placeholder text all about me (Mars).', this.canvas.width / 2, this.canvas.height / 2);
    }

    renderOSScreen() {
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '3rem Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('MartianOS', this.canvas.width / 2, this.canvas.height / 2 - 50);
    }

    renderDesktopScreen() {
        this.ctx.fillStyle = '#1a237e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = '#9e9e9e';
        this.ctx.fillRect(0, 0, this.canvas.width, 40);

        this.ctx.fillStyle = '#000';
        this.ctx.font = '0.9rem Courier New';
        const now = new Date();
        const time = now.toLocaleTimeString();
        this.ctx.fillText(time, this.canvas.width - 100, 25);
    }

    isInPowerButton(x, y) {
        return x > 10 && x < 50 && y > 5 && y < 35;
    }

    isInPowerMenuArea(x, y) {
        if (!this.showPowerMenu) return false;
        return x >= 10 && x <= 130 && y >= 40 && y <= 115;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded - starting MartianOS');
    new MartianOS();
});
