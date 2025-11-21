export class Animation {
    constructor(duration, updateCallback, options = {}) {
        this.duration = duration;
        this.updateCallback = updateCallback;
        this.easing = options.easing || 'linear';
        this.onComplete = options.onComplete || null;
        this.startTime = null;
        this.isRunning = false;
        this.delay = options.delay || 0;
    }

    start() {
        this.startTime = Date.now() + this.delay;
        this.isRunning = true;
    }

    update() {
        if (!this.isRunning) return false;

        const now = Date.now();
        if (now < this.startTime) return true; // Still in delay

        const elapsed = now - this.startTime;
        const progress = Math.min(elapsed / this.duration, 1);
        
        const easedProgress = this.applyEasing(progress);
        this.updateCallback(easedProgress);
        
        if (progress >= 1) {
            this.isRunning = false;
            if (this.onComplete) this.onComplete();
            return false;
        }
        return true;
    }

    applyEasing(progress) {
        switch (this.easing) {
            case 'easeIn': return progress * progress;
            case 'easeOut': return 1 - (1 - progress) * (1 - progress);
            case 'easeInOut': 
                return progress < 0.5 
                    ? 2 * progress * progress 
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            case 'bounce':
                if (progress < 1 / 2.75) {
                    return 7.5625 * progress * progress;
                } else if (progress < 2 / 2.75) {
                    return 7.5625 * (progress -= 1.5 / 2.75) * progress + 0.75;
                } else if (progress < 2.5 / 2.75) {
                    return 7.5625 * (progress -= 2.25 / 2.75) * progress + 0.9375;
                } else {
                    return 7.5625 * (progress -= 2.625 / 2.75) * progress + 0.984375;
                }
            default: return progress;
        }
    }

    stop() {
        this.isRunning = false;
    }
}