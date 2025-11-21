export class AnimationManager {
    constructor() {
        this.animations = new Set();
    }

    add(animation) {
        this.animations.add(animation);
        animation.start();
    }

    remove(animation) {
        this.animations.delete(animation);
    }

    update() {
        for (const animation of this.animations) {
            const stillRunning = animation.update();
            if (!stillRunning) {
                this.animations.delete(animation);
            }
        }
    }

    clear() {
        this.animations.clear();
    }

    get count() {
        return this.animations.size;
    }
}