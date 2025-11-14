/**
 * Performance Utilities for UI Optimization
 * Includes debouncing, throttling, and virtual scrolling helpers
 */

class PerformanceUtils {
    constructor() {
        this.debounceTimers = new Map();
        this.throttleTimers = new Map();
        this.rafCallbacks = new Map();
        this.batchedUpdates = [];
        this.updateScheduled = false;
    }

    /**
     * Debounce function calls
     * @param {Function} func - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @param {string} key - Unique key for this debounce
     */
    debounce(func, delay = 300, key = null) {
        const debounceKey = key || func.toString();
        
        return (...args) => {
            // Clear existing timer
            if (this.debounceTimers.has(debounceKey)) {
                clearTimeout(this.debounceTimers.get(debounceKey));
            }
            
            // Set new timer
            const timer = setTimeout(() => {
                func(...args);
                this.debounceTimers.delete(debounceKey);
            }, delay);
            
            this.debounceTimers.set(debounceKey, timer);
        };
    }

    /**
     * Throttle function calls
     * @param {Function} func - Function to throttle
     * @param {number} limit - Time limit in milliseconds
     * @param {string} key - Unique key for this throttle
     */
    throttle(func, limit = 100, key = null) {
        const throttleKey = key || func.toString();
        let inThrottle = this.throttleTimers.has(throttleKey);
        
        return (...args) => {
            if (!inThrottle) {
                func(...args);
                this.throttleTimers.set(throttleKey, true);
                
                setTimeout(() => {
                    this.throttleTimers.delete(throttleKey);
                }, limit);
            }
        };
    }

    /**
     * Request animation frame wrapper
     * @param {Function} callback - Callback to execute
     * @param {string} key - Unique key for this RAF
     */
    requestAnimationFrame(callback, key = null) {
        const rafKey = key || callback.toString();
        
        // Cancel existing RAF if present
        if (this.rafCallbacks.has(rafKey)) {
            cancelAnimationFrame(this.rafCallbacks.get(rafKey));
        }
        
        const rafId = requestAnimationFrame(() => {
            callback();
            this.rafCallbacks.delete(rafKey);
        });
        
        this.rafCallbacks.set(rafKey, rafId);
        return rafId;
    }

    /**
     * Batch DOM updates
     * @param {Function} updateFn - Update function to batch
     */
    batchUpdate(updateFn) {
        this.batchedUpdates.push(updateFn);
        
        if (!this.updateScheduled) {
            this.updateScheduled = true;
            
            requestAnimationFrame(() => {
                const updates = [...this.batchedUpdates];
                this.batchedUpdates = [];
                this.updateScheduled = false;
                
                // Execute all updates in one frame
                updates.forEach(fn => fn());
            });
        }
    }

    /**
     * Virtual scrolling helper
     * @param {Object} config - Virtual scrolling configuration
     */
    createVirtualScroller(config) {
        return new VirtualScroller(config);
    }

    /**
     * Lazy loading observer
     * @param {Element} element - Element to observe
     * @param {Function} callback - Callback when element is visible
     * @param {Object} options - Intersection observer options
     */
    lazyLoad(element, callback, options = {}) {
        const defaultOptions = {
            root: null,
            rootMargin: '50px',
            threshold: 0.01,
            ...options
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    callback(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, defaultOptions);

        observer.observe(element);
        return observer;
    }

    /**
     * Memoization helper
     * @param {Function} fn - Function to memoize
     * @param {Function} keyGenerator - Generate cache key from arguments
     */
    memoize(fn, keyGenerator = JSON.stringify) {
        const cache = new Map();
        
        return function(...args) {
            const key = keyGenerator(args);
            
            if (cache.has(key)) {
                return cache.get(key);
            }
            
            const result = fn.apply(this, args);
            cache.set(key, result);
            
            // Limit cache size
            if (cache.size > 100) {
                const firstKey = cache.keys().next().value;
                cache.delete(firstKey);
            }
            
            return result;
        };
    }

    /**
     * Clean up all timers
     */
    cleanup() {
        // Clear debounce timers
        this.debounceTimers.forEach(timer => clearTimeout(timer));
        this.debounceTimers.clear();
        
        // Clear throttle flags
        this.throttleTimers.clear();
        
        // Cancel RAF callbacks
        this.rafCallbacks.forEach(id => cancelAnimationFrame(id));
        this.rafCallbacks.clear();
        
        // Clear batched updates
        this.batchedUpdates = [];
        this.updateScheduled = false;
    }
}

/**
 * Virtual Scroller Implementation
 */
class VirtualScroller {
    constructor(config) {
        this.container = config.container;
        this.items = config.items || [];
        this.itemHeight = config.itemHeight || 50;
        this.bufferSize = config.bufferSize || 5;
        this.renderItem = config.renderItem;
        
        this.scrollTop = 0;
        this.visibleStart = 0;
        this.visibleEnd = 0;
        
        this.init();
    }

    init() {
        if (!this.container) return;
        
        // Create viewport
        this.viewport = document.createElement('div');
        this.viewport.style.height = '100%';
        this.viewport.style.overflow = 'auto';
        this.viewport.style.position = 'relative';
        
        // Create content container
        this.content = document.createElement('div');
        this.content.style.position = 'relative';
        this.content.style.height = `${this.items.length * this.itemHeight}px`;
        
        // Create visible items container
        this.visibleContent = document.createElement('div');
        this.visibleContent.style.position = 'absolute';
        this.visibleContent.style.top = '0';
        this.visibleContent.style.left = '0';
        this.visibleContent.style.right = '0';
        
        this.content.appendChild(this.visibleContent);
        this.viewport.appendChild(this.content);
        this.container.appendChild(this.viewport);
        
        // Add scroll listener
        this.viewport.addEventListener('scroll', this.handleScroll.bind(this));
        
        // Initial render
        this.render();
    }

    handleScroll() {
        this.scrollTop = this.viewport.scrollTop;
        this.render();
    }

    render() {
        const viewportHeight = this.viewport.clientHeight;
        
        // Calculate visible range
        this.visibleStart = Math.floor(this.scrollTop / this.itemHeight);
        this.visibleEnd = Math.ceil((this.scrollTop + viewportHeight) / this.itemHeight);
        
        // Add buffer
        this.visibleStart = Math.max(0, this.visibleStart - this.bufferSize);
        this.visibleEnd = Math.min(this.items.length, this.visibleEnd + this.bufferSize);
        
        // Clear current content
        this.visibleContent.innerHTML = '';
        
        // Render visible items
        for (let i = this.visibleStart; i < this.visibleEnd; i++) {
            const item = this.items[i];
            const element = this.renderItem(item, i);
            
            // Position element
            element.style.position = 'absolute';
            element.style.top = `${i * this.itemHeight}px`;
            element.style.height = `${this.itemHeight}px`;
            
            this.visibleContent.appendChild(element);
        }
        
        // Update visible content position
        this.visibleContent.style.transform = `translateY(${this.visibleStart * this.itemHeight}px)`;
    }

    updateItems(items) {
        this.items = items;
        this.content.style.height = `${this.items.length * this.itemHeight}px`;
        this.render();
    }

    scrollToItem(index) {
        const scrollTop = index * this.itemHeight;
        this.viewport.scrollTop = scrollTop;
    }

    destroy() {
        if (this.viewport) {
            this.viewport.removeEventListener('scroll', this.handleScroll);
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

/**
 * Performance Monitor for UI
 */
class UIPerformanceMonitor {
    constructor() {
        this.metrics = {
            fps: 0,
            renderTime: 0,
            scriptTime: 0,
            layoutTime: 0,
            paintTime: 0
        };
        
        this.frames = [];
        this.lastFrameTime = performance.now();
        this.monitoring = false;
    }

    start() {
        if (this.monitoring) return;
        this.monitoring = true;
        this.measureFrame();
    }

    measureFrame() {
        if (!this.monitoring) return;
        
        const now = performance.now();
        const delta = now - this.lastFrameTime;
        
        this.frames.push(delta);
        if (this.frames.length > 60) {
            this.frames.shift();
        }
        
        // Calculate FPS
        const averageFrameTime = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
        this.metrics.fps = Math.round(1000 / averageFrameTime);
        
        this.lastFrameTime = now;
        
        requestAnimationFrame(() => this.measureFrame());
    }

    stop() {
        this.monitoring = false;
    }

    getMetrics() {
        // Get performance entries
        const entries = performance.getEntriesByType('measure');
        
        entries.forEach(entry => {
            if (entry.name.includes('render')) {
                this.metrics.renderTime = entry.duration;
            } else if (entry.name.includes('script')) {
                this.metrics.scriptTime = entry.duration;
            } else if (entry.name.includes('layout')) {
                this.metrics.layoutTime = entry.duration;
            } else if (entry.name.includes('paint')) {
                this.metrics.paintTime = entry.duration;
            }
        });
        
        return this.metrics;
    }

    markStart(name) {
        performance.mark(`${name}-start`);
    }

    markEnd(name) {
        performance.mark(`${name}-end`);
        performance.measure(name, `${name}-start`, `${name}-end`);
    }
}

// Export utilities for both Node.js and browser
const exports = {
    PerformanceUtils: new PerformanceUtils(),
    VirtualScroller,
    UIPerformanceMonitor: new UIPerformanceMonitor()
};

// Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
}

// Browser environment
if (typeof window !== 'undefined') {
    window.PerformanceUtils = exports.PerformanceUtils;
    window.VirtualScroller = exports.VirtualScroller;
    window.UIPerformanceMonitor = exports.UIPerformanceMonitor;
}