/**
 * Base class for singleton pattern implementation
 * Provides standardized getInstance(), reset(), and cleanup() methods
 * @template T
 */
class SingletonBase {
    /**
     * @private
     * @type {Map<Function, SingletonBase>}
     */
    static _instances = new Map();

    /**
     * Get the singleton instance
     * @returns {this}
     */
    static getInstance() {
        const Class = this;
        if (!SingletonBase._instances.has(Class)) {
            SingletonBase._instances.set(Class, new Class());
        }
        return SingletonBase._instances.get(Class);
    }

    /**
     * Reset the singleton instance (for testing)
     * Creates a new instance, discarding the old one
     * @returns {this}
     */
    static resetInstance() {
        const Class = this;
        const instance = SingletonBase._instances.get(Class);
        if (instance && typeof instance.cleanup === 'function') {
            instance.cleanup();
        }
        SingletonBase._instances.delete(Class);
        return Class.getInstance();
    }

    /**
     * Check if instance exists
     * @returns {boolean}
     */
    static hasInstance() {
        return SingletonBase._instances.has(this);
    }

    /**
     * Cleanup method to be overridden by subclasses
     * Called when instance is reset or application shuts down
     */
    cleanup() {
        // Override in subclass
    }

    /**
     * Initialize method to be overridden by subclasses
     * @param {Object} config - Configuration options
     * @returns {Promise<{success: boolean}>}
     */
    async initialize(config = {}) {
        this.config = config;
        return { success: true };
    }
}

/**
 * Creates a singleton wrapper for existing classes
 * Use this to add singleton behavior to classes that already exist
 * @param {Function} Class - The class to wrap
 * @param {Object} options - Options for the singleton
 * @returns {{getInstance: Function, Class: Function, instance: Object}}
 */
function createSingleton(Class, options = {}) {
    let instance = null;

    return {
        /**
         * Get the singleton instance
         * @returns {Object}
         */
        getInstance() {
            if (!instance) {
                instance = new Class();
                if (options.autoInitialize && typeof instance.initialize === 'function') {
                    instance.initialize(options.config || {});
                }
            }
            return instance;
        },

        /**
         * Reset the singleton instance
         * @returns {Object}
         */
        resetInstance() {
            if (instance && typeof instance.cleanup === 'function') {
                instance.cleanup();
            }
            instance = null;
            return this.getInstance();
        },

        /**
         * Check if instance exists
         * @returns {boolean}
         */
        hasInstance() {
            return instance !== null;
        },

        /**
         * Get the class for testing or subclassing
         */
        Class,

        /**
         * Get or create the default instance
         */
        get instance() {
            return this.getInstance();
        }
    };
}

module.exports = {
    SingletonBase,
    createSingleton
};
