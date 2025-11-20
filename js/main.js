// /js/main.js
import { Button } from './button.js';

class MartianOS {
    constructor() {
        this.canvas = document.getElementById('martian-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentScreen = 'matrix';
        this.showPowerMenu = false;
        this.lastTime = 0;
        this.buttons = [];
        this.mouseX = 0;
        this.mouseY = 0;
        
        this.setupCanvas();
        this.setupEventListeners();
        this.animate();
        this.createButtons();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.createButtons();
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

        if (this.currentScreen === 'desktop') {
            if (this.isInPowerButton(x, y)) {
                this.showPowerMenu = !this.showPowerMenu;
                this.createButtons();
            } else if (this.showPowerMenu) {
                if (this.isInPowerOption(x, y, 'shutdown')) {
                    this.currentScreen = 'matrix';
                    this.showPowerMenu = false;
                    this.createButtons();
                } else if (this.isInPowerOption(x, y, 'restart')) {
                    this.currentScreen = 'os';
                    this.showPowerMenu = false;
                    this.createButtons();
                }
            }
        }
    }

    createButtons() {
        this.buttons = [];
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        switch (this.currentScreen) {
            case 'matrix':
                this.buttons.push(new Button(
                    centerX, centerY + 45, 200, 50, 'About Me',
                    () => { this.currentScreen = 'about'; this.createButtons(); }
                ));
                this.buttons.push(new Button(
                    centerX, centerY + 115, 200, 50, 'ENTER',
                    () => { this.currentScreen = 'os'; this.createButtons(); }
                ));
                break;
            case 'about':
                this.buttons.push(new Button(
                    centerX, centerY + 125, 200, 50, 'Back',
                    () => { this.currentScreen = 'matrix'; this.createButtons(); }
                ));
                break;
            case 'os':
                this.buttons.push(new Button(
                    centerX, centerY + 75, 200, 50, 'START',
                    () => { this.currentScreen = 'desktop'; this.createButtons(); },
                    { backgroundColor: '#000', textColor: '#fff' }
                ));
                break;
        }
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
        this.ctx.fillStyle = '#1a237e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = '#9e9e9e';
        this.ctx.fillRect(0, 0, this.canvas.width, 40);

        this.ctx.fillStyle = '#000';
        this.ctx.font = '1.2rem Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('M', 35, 25);

        this.ctx.fillStyle = '#000';
        this.ctx.font = '0.9rem Courier New';
        const now = new Date();
        const time = now.toLocaleTimeString();
        this.ctx.fillText(time, this.canvas.width - 100, 25);

        if (this.showPowerMenu) {
            this.ctx.fillStyle = '#e0e0e0';
            this.ctx.fillRect(20, 40, 100, 70);
            
            this.ctx.fillStyle = '#333';
            this.ctx.font = '0.9rem Courier New';
            this.ctx.textAlign = 'left';
            this.ctx.fillText('Restart', 30, 65);
            this.ctx.fillText('Shut Down', 30, 95);
        }
    }

    isInPowerButton(x, y) {
        return x > 20 && x < 50 && y > 10 && y < 40;
    }

    isInPowerOption(x, y, option) {
        if (!this.showPowerMenu) return false;
        const optionY = option === 'shutdown' ? 50 : 80;
        return x > 20 && x < 120 && y > optionY && y < optionY + 30;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MartianOS();
});
