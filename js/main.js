// /js/main.js - DIAGNOSTIC VERSION
import { Button, TaskbarButton, MenuItem } from './system/index.js';

class MartianOS {
    constructor() {
        console.log('MartianOS: Starting diagnostic version...');
        
        this.canvas = document.getElementById('martian-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentScreen = 'matrix';
        this.showPowerMenu = false;
        this.showPowerSubmenu = false;
        this.buttons = [];
        this.menuItems = [];
        this.mouseX = 0;
        this.mouseY = 0;
        this.frameCount = 0;
        
        this.setupCanvas();
        this.setupEventListeners();
        this.animate();
        this.createUI();
    }

    // ... (setupCanvas, setupEventListeners, handleMouseMove remain the same) ...

    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        console.log(`=== CLICK DEBUG ===`);
        console.log(`Click at: ${x}, ${y}`);
        console.log(`Current screen: ${this.currentScreen}`);
        console.log(`Show power menu: ${this.showPowerMenu}`);
        console.log(`Buttons count: ${this.buttons.length}`);
        console.log(`Menu items count: ${this.menuItems.length}`);

        // Log all button bounds for debugging
        this.buttons.forEach((button, index) => {
            console.log(`Button ${index}:`, button.bounds);
        });

        // ... (rest of handleClick remains the same) ...
    }

    createDesktopUI() {
        console.log('=== CREATING DESKTOP UI ===');
        
        // Taskbar M button - let's test with a regular Button first
        console.log('Creating power button...');
        const powerButton = new TaskbarButton(
            10, 5, 40, 30, 'M',
            () => { 
                console.log('M button clicked - current state:', this.showPowerMenu);
                this.showPowerMenu = !this.showPowerMenu; 
                this.showPowerSubmenu = false;
                this.createUI(); 
            }
        );
        
        console.log('Power button created:', {
            bounds: powerButton.bounds,
            backgroundColor: powerButton.backgroundColor,
            textColor: powerButton.textColor
        });
        
        this.buttons.push(powerButton);

        // ... (rest of createDesktopUI remains the same) ...
    }

    animate(currentTime = 0) {
        requestAnimationFrame((time) => this.animate(time));
        this.render();
        this.frameCount++;
        
        // Log every 60 frames to avoid console spam
        if (this.frameCount % 60 === 0 && this.currentScreen === 'desktop') {
            console.log(`=== FRAME ${this.frameCount} DEBUG ===`);
            console.log('Rendering desktop with:', {
                buttons: this.buttons.length,
                menuItems: this.menuItems.length,
                showPowerMenu: this.showPowerMenu
            });
        }
    }

    render() {
        // Clear canvas with a subtle grid for debugging
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw subtle grid for coordinate debugging
        this.ctx.strokeStyle = '#222';
        this.ctx.lineWidth = 1;
        for (let x = 0; x < this.canvas.width; x += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        for (let y = 0; y < this.canvas.height; y += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }

        // Render current screen background
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

        // Render debug info for buttons
        this.buttons.forEach((button, index) => {
            if (button.draw) {
                console.log(`Drawing button ${index}:`, button.bounds);
                button.draw(this.ctx);
                
                // Draw debug outline
                this.ctx.strokeStyle = '#f00';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(button.bounds.x, button.bounds.y, button.bounds.width, button.bounds.height);
                
                // Draw debug text
                this.ctx.fillStyle = '#f00';
                this.ctx.font = '8px Arial';
                this.ctx.fillText(`Btn${index}`, button.bounds.x, button.bounds.y - 5);
            }
        });
        
        this.menuItems.forEach((item, index) => {
            if (item.draw) {
                console.log(`Drawing menu item ${index}:`, item.bounds);
                item.draw(this.ctx);
            }
        });
    }

    // ... (rest of the methods remain the same) ...
}

document.addEventListener('DOMContentLoaded', () => {
    new MartianOS();
});
