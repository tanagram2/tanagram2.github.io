// /js/main.js
import { Button } from './system/index.js';

class MartianOS {
    constructor() {
        this.canvas = document.getElementById('martian-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentScreen = 'matrix';
        this.buttons = [];
        this.mouseX = 0;
        this.mouseY = 0;
        
        this.setupCanvas();
        this.setupEventListeners();
        this.animate();
        this.createUI();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.createUI();
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        
        this.buttons.forEach(button => button.handleMouseMove(this.mouseX, this.mouseY));
    }

    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (let button of this.buttons) {
            if (button.handleClick(x, y)) {
                return;
            }
        }

        // Simple M click detection
        if (this.currentScreen === 'desktop' && x > 10 && x < 50 && y > 5 && y < 35) {
            console.log('M clicked!');
        }
    }

    createUI() {
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
    }

    createMatrixUI(centerX, centerY) {
        const aboutButton = new Button(
            centerX, centerY + 45, 200, 50, 'About Me',
            () => { this.currentScreen = 'about'; this.createUI(); }
        );
        
        const enterButton = new Button(
            centerX, centerY + 115, 200, 50, 'ENTER',
            () => { this.currentScreen = 'os'; this.createUI(); }
        );
        
        this.buttons.push(aboutButton, enterButton);
    }

    createAboutUI(centerX, centerY) {
        const backButton = new Button(
            centerX, centerY + 125, 200, 50, 'Back',
            () => { this.currentScreen = 'matrix'; this.createUI(); }
        );
        
        this.buttons.push(backButton);
    }

    createOSUI(centerX, centerY) {
        const startButton = new Button(
            centerX, centerY + 75, 200, 50, 'START',
            () => { this.currentScreen = 'desktop'; this.createUI(); },
            { backgroundColor: '#000', textColor: '#fff' }
        );
        
        this.buttons.push(startButton);
    }

    createDesktopUI() {
        // No button creation - we'll just draw the M directly in renderDesktopScreen
    }

    animate(currentTime = 0) {
        requestAnimationFrame((time) => this.animate(time));
        this.render();
    }

    render() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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

        this.buttons.forEach(button => button.draw(this.ctx));
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
        // Blue desktop background
        this.ctx.fillStyle = '#1a237e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Gray taskbar
        this.ctx.fillStyle = '#9e9e9e';
        this.ctx.fillRect(0, 0, this.canvas.width, 40);

        // SIMPLE GREEN "M" in top-left corner
        this.ctx.fillStyle = '#0f0';
        this.ctx.font = '1.5rem Courier New';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        this.ctx.fillText('M', 20, 10);

        // Clock
        this.ctx.fillStyle = '#000';
        this.ctx.font = '0.9rem Courier New';
        const now = new Date();
        const time = now.toLocaleTimeString();
        this.ctx.fillText(time, this.canvas.width - 100, 25);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MartianOS();
});
