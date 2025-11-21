export class RenderManager {
    constructor(ctx) {
        this.ctx = ctx;
        this.layers = new Map(); // layerName -> Set of drawable objects
        this.defaultLayer = 'main';
        this.dirty = true;
    }

    add(drawable, layerName = this.defaultLayer) {
        if (!this.layers.has(layerName)) {
            this.layers.set(layerName, new Set());
        }
        this.layers.get(layerName).add(drawable);
        this.markDirty();
    }

    remove(drawable, layerName = null) {
        let removed = false;
        
        if (layerName) {
            // Remove from specific layer
            if (this.layers.has(layerName)) {
                removed = this.layers.get(layerName).delete(drawable);
            }
        } else {
            // Remove from ALL layers
            for (const layer of this.layers.values()) {
                if (layer.delete(drawable)) {
                    removed = true;
                }
            }
        }
        
        if (removed) {
            this.markDirty();
        }
        return removed;
    }

    removeFromAllLayers(drawable) {
        return this.remove(drawable); // null layerName means remove from all
    }

    clearLayer(layerName) {
        if (this.layers.has(layerName)) {
            this.layers.get(layerName).clear();
            this.markDirty();
        }
    }

    clearAll() {
        this.layers.clear();
        this.markDirty();
    }

    markDirty() {
        this.dirty = true;
    }

    render() {
        if (!this.dirty) return;

        // Clear entire canvas
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        
        // Render layers in order (lowest z-index first)
        const sortedLayers = Array.from(this.layers.keys()).sort();
        for (const layerName of sortedLayers) {
            const layer = this.layers.get(layerName);
            for (const drawable of layer) {
                if (drawable.draw) {
                    drawable.draw(this.ctx);
                }
            }
        }
        
        this.dirty = false;
    }

    forceRender() {
        this.dirty = true;
        this.render();
    }
}