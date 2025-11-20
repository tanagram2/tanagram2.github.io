// /js/system/drag-drop-manager.js
export class DragDropManager {
    constructor(eventDispatcher, inputManager) {
        this.eventDispatcher = eventDispatcher;
        this.inputManager = inputManager;
        this.dragSources = new Map();
        this.dropTargets = new Map();
        this.currentDrag = null;
        this.currentDropTarget = null;
        
        this.setupDragListeners();
    }

    setupDragListeners() {
        this.eventDispatcher.addEventListener('mousemove', (event) => {
            this.handleDragMove(event);
        });

        this.eventDispatcher.addEventListener('mouseup', (event) => {
            this.handleDragEnd(event);
        });
    }

    registerDragSource(element, dataProvider) {
        this.dragSources.set(element, dataProvider);
        
        element.handleMouseMove = (x, y) => {
            if (this.inputManager.isMouseButtonPressed(0) && 
                !this.inputManager.isDragging() &&
                this.isDragThresholdMet(element, x, y)) {
                this.startDrag(element, x, y);
            }
        };
    }

    registerDropTarget(element, dropHandler) {
        this.dropTargets.set(element, dropHandler);
        
        // Override handleMouseMove to detect drag over
        const originalHandleMouseMove = element.handleMouseMove;
        element.handleMouseMove = (x, y) => {
            originalHandleMouseMove?.(x, y);
            
            if (this.currentDrag && this.isPointInElement(x, y, element)) {
                this.setDropTarget(element);
            } else if (this.currentDropTarget === element) {
                this.clearDropTarget();
            }
        };
    }

    startDrag(element, startX, startY) {
        const dataProvider = this.dragSources.get(element);
        if (!dataProvider) return;

        const dragData = dataProvider();
        this.currentDrag = {
            element,
            data: dragData,
            startX,
            startY
        };

        this.inputManager.startDrag(element, dragData);
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('dragstart', {
                dragElement: element,
                dragData,
                x: startX,
                y: startY
            })
        );
    }

    handleDragMove(event) {
        if (!this.currentDrag) return;

        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('drag', {
                dragElement: this.currentDrag.element,
                dragData: this.currentDrag.data,
                x: event.x,
                y: event.y
            })
        );
    }

    handleDragEnd(event) {
        if (!this.currentDrag) return;

        if (this.currentDropTarget) {
            const dropHandler = this.dropTargets.get(this.currentDropTarget);
            if (dropHandler) {
                dropHandler(this.currentDrag.data, event.x, event.y);
            }
            
            this.eventDispatcher.dispatchEvent(
                this.eventDispatcher.createEvent('drop', {
                    dragElement: this.currentDrag.element,
                    dropElement: this.currentDropTarget,
                    dragData: this.currentDrag.data,
                    x: event.x,
                    y: event.y
                })
            );
        } else {
            this.eventDispatcher.dispatchEvent(
                this.eventDispatcher.createEvent('dragend', {
                    dragElement: this.currentDrag.element,
                    dragData: this.currentDrag.data,
                    x: event.x,
                    y: event.y
                })
            );
        }

        this.clearDropTarget();
        this.currentDrag = null;
        this.inputManager.endDrag();
    }

    setDropTarget(element) {
        if (this.currentDropTarget === element) return;
        
        if (this.currentDropTarget) {
            this.eventDispatcher.dispatchEvent(
                this.eventDispatcher.createEvent('dragleave', {
                    dragElement: this.currentDrag.element,
                    dropElement: this.currentDropTarget
                })
            );
        }
        
        this.currentDropTarget = element;
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('dragenter', {
                dragElement: this.currentDrag.element,
                dropElement: element
            })
        );
    }

    clearDropTarget() {
        if (this.currentDropTarget) {
            this.eventDispatcher.dispatchEvent(
                this.eventDispatcher.createEvent('dragleave', {
                    dragElement: this.currentDrag.element,
                    dropElement: this.currentDropTarget
                })
            );
        }
        this.currentDropTarget = null;
    }

    isDragThresholdMet(element, currentX, currentY) {
        const startPos = this.inputManager.mouseState.dragStart;
        if (!startPos) return false;
        
        const dx = Math.abs(currentX - startPos.x);
        const dy = Math.abs(currentY - startPos.y);
        return dx > 5 || dy > 5; // 5px threshold
    }

    isPointInElement(x, y, element) {
        return CoordinateSystem.isPointInElement(x, y, element);
    }
}
