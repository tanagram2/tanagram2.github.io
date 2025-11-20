// /js/system/notification-manager.js
export class NotificationManager {
    constructor(eventDispatcher, layerManager) {
        this.eventDispatcher = eventDispatcher;
        this.layerManager = layerManager;
        this.notifications = new Map();
        this.nextNotificationId = 1;
        this.defaultDuration = 5000; // 5 seconds
    }

    showNotification(title, message, options = {}) {
        const id = this.nextNotificationId++;
        const duration = options.duration || this.defaultDuration;
        
        const notification = {
            id,
            title,
            message,
            type: options.type || 'info', // info, warning, error, success
            duration,
            timestamp: Date.now(),
            element: this.createNotificationElement(id, title, message, options)
        };
        
        this.notifications.set(id, notification);
        
        // Auto-dismiss after duration
        if (duration > 0) {
            setTimeout(() => {
                this.dismissNotification(id);
            }, duration);
        }
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('notificationshow', { notification })
        );
        
        return id;
    }

    dismissNotification(id) {
        const notification = this.notifications.get(id);
        if (!notification) return;
        
        this.notifications.delete(id);
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('notificationdismiss', { notification })
        );
    }

    dismissAll() {
        this.notifications.forEach((notification, id) => {
            this.dismissNotification(id);
        });
    }

    createNotificationElement(id, title, message, options) {
        const width = 300;
        const height = 100;
        
        // Position notifications in top-right corner
        const x = window.innerWidth - width - 20;
        const y = 20 + (Array.from(this.notifications.keys()).length * (height + 10));
        
        return {
            bounds: { x, y, width, height },
            id,
            containsPoint(px, py) {
                return CoordinateSystem.isPointInElement(px, py, this);
            },
            draw(ctx) {
                // Draw notification background based on type
                const bgColor = this.getBackgroundColor(options.type);
                ctx.fillStyle = bgColor;
                ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
                
                // Draw border
                ctx.strokeStyle = '#666';
                ctx.lineWidth = 1;
                ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
                
                // Draw title
                ctx.fillStyle = '#000';
                ctx.font = 'bold 0.9rem Courier New';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(title, this.bounds.x + 10, this.bounds.y + 10);
                
                // Draw message
                ctx.font = '0.8rem Courier New';
                ctx.fillText(message, this.bounds.x + 10, this.bounds.y + 35);
                
                // Draw close button
                ctx.fillStyle = '#666';
                ctx.fillRect(this.bounds.x + this.bounds.width - 25, this.bounds.y + 5, 20, 20);
                ctx.fillStyle = '#fff';
                ctx.font = '0.8rem Courier New';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('X', this.bounds.x + this.bounds.width - 15, this.bounds.y + 15);
            },
            handleClick(px, py) {
                const closeButtonX = this.bounds.x + this.bounds.width - 25;
                const closeButtonY = this.bounds.y + 5;
                
                if (px >= closeButtonX && px <= closeButtonX + 20 &&
                    py >= closeButtonY && py <= closeButtonY + 20) {
                    // Clicked close button
                    this.dismissNotification(id);
                    return true;
                }
                
                // Clicked notification body
                if (options.onClick) {
                    options.onClick();
                }
                return true;
            },
            getBackgroundColor(type) {
                switch (type) {
                    case 'warning': return '#fff3cd';
                    case 'error': return '#f8d7da';
                    case 'success': return '#d1edff';
                    default: return '#e0e0e0';
                }
            }
        };
    }

    getNotifications() {
        return Array.from(this.notifications.values());
    }

    updatePositions() {
        // Recalculate notification positions
        let y = 20;
        this.notifications.forEach(notification => {
            notification.element.bounds.y = y;
            y += notification.element.bounds.height + 10;
        });
    }
}
