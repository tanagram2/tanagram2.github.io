// /js/system/theme-manager.js
export class ThemeManager {
    constructor() {
        this.currentTheme = 'martian';
        this.themes = new Map();
        this.loadDefaultThemes();
    }

    loadDefaultThemes() {
        // Martian Theme (default)
        this.themes.set('martian', {
            name: 'Martian',
            colors: {
                primary: '#0f0',
                secondary: '#1a237e',
                background: '#000',
                surface: '#1a237e',
                error: '#f00',
                warning: '#ff0',
                success: '#0f0',
                text: {
                    primary: '#fff',
                    secondary: '#ccc',
                    disabled: '#666'
                },
                ui: {
                    button: '#0f0',
                    buttonHover: '#0c0',
                    buttonActive: '#090',
                    taskbar: '#9e9e9e',
                    menu: '#e0e0e0',
                    menuHover: '#bdbdbd'
                }
            },
            fonts: {
                primary: 'Courier New, monospace',
                sizes: {
                    small: '0.8rem',
                    normal: '1rem',
                    large: '1.2rem',
                    heading: '2.5rem',
                    title: '3rem'
                }
            },
            spacing: {
                xs: '5px',
                sm: '10px',
                md: '15px',
                lg: '20px',
                xl: '30px'
            },
            borderRadius: {
                sm: '3px',
                md: '5px',
                lg: '10px'
            }
        });

        // Light Theme
        this.themes.set('light', {
            name: 'Light',
            colors: {
                primary: '#1976d2',
                secondary: '#dc004e',
                background: '#f5f5f5',
                surface: '#fff',
                error: '#f44336',
                warning: '#ff9800',
                success: '#4caf50',
                text: {
                    primary: '#212121',
                    secondary: '#757575',
                    disabled: '#9e9e9e'
                },
                ui: {
                    button: '#1976d2',
                    buttonHover: '#1565c0',
                    buttonActive: '#0d47a1',
                    taskbar: '#e0e0e0',
                    menu: '#fff',
                    menuHover: '#f5f5f5'
                }
            },
            fonts: {
                primary: 'Arial, sans-serif',
                sizes: {
                    small: '0.8rem',
                    normal: '1rem',
                    large: '1.2rem',
                    heading: '2.5rem',
                    title: '3rem'
                }
            },
            spacing: {
                xs: '5px',
                sm: '10px',
                md: '15px',
                lg: '20px',
                xl: '30px'
            },
            borderRadius: {
                sm: '3px',
                md: '5px',
                lg: '10px'
            }
        });
    }

    setTheme(themeName) {
        if (this.themes.has(themeName)) {
            this.currentTheme = themeName;
            this.applyTheme();
        }
    }

    applyTheme() {
        const theme = this.themes.get(this.currentTheme);
        
        // Dispatch theme change event for components to react
        document.dispatchEvent(new CustomEvent('themechange', {
            detail: { theme }
        }));
    }

    getTheme() {
        return this.themes.get(this.currentTheme);
    }

    getColor(path) {
        const theme = this.getTheme();
        const parts = path.split('.');
        let value = theme;
        
        for (const part of parts) {
            value = value[part];
            if (value === undefined) return '#000'; // Fallback color
        }
        
        return value;
    }

    getFont(size = 'normal') {
        const theme = this.getTheme();
        return `${theme.fonts.sizes[size]} ${theme.fonts.primary}`;
    }

    getSpacing(size = 'md') {
        const theme = this.getTheme();
        return theme.spacing[size];
    }

    getBorderRadius(size = 'md') {
        const theme = this.getTheme();
        return theme.borderRadius[size];
    }

    registerTheme(name, themeConfig) {
        this.themes.set(name, themeConfig);
    }
}
