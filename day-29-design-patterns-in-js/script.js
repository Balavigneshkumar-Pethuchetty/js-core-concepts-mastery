// ============================================================
// DAY 29: CLASSIC DESIGN PATTERNS, IDIOMATIC JS
// ============================================================
// Run this in a browser console, via index.html, or with Node.

// ============================================================
// 1. HAPPY PATH — Module pattern via IIFE (revealing module variant)
// ============================================================

console.log('--- 1. Revealing module pattern: a private counter ---');

const counterModule = (function revealingModuleIIFE() {
  // This variable lives only inside this IIFE's closure — nothing
  // outside this function can reach it directly, ever.
  let count = 0;

  function increment() {
    count += 1;
    return count;
  }

  function decrement() {
    count -= 1;
    return count;
  }

  function getCount() {
    return count;
  }

  function reset() {
    count = 0;
  }

  // The "revealing" part: define everything as named local functions
  // first, THEN return one object literal that explicitly maps the
  // public names to them — the public API reads as a single clear list.
  return {
    increment,
    decrement,
    getCount,
    reset,
  };
})();

console.log(counterModule.increment()); // 1
console.log(counterModule.increment()); // 2
console.log(counterModule.decrement()); // 1
console.log(counterModule.getCount()); // 1
console.log('Direct access to internal `count` is impossible:', counterModule.count); // undefined — truly private

// A factory version of the same pattern: calling this function again
// creates an ENTIRELY SEPARATE closure/counter — proving the privacy
// is per-instance, not a single shared global.
function createCounter(startAt = 0) {
  let count = startAt;
  return {
    increment: () => (count += 1),
    getCount: () => count,
  };
}

const counterA = createCounter(0);
const counterB = createCounter(100);
counterA.increment();
counterB.increment();
console.log('counterA:', counterA.getCount()); // 1
console.log('counterB:', counterB.getCount()); // 101 — independent private state per instance

// ============================================================
// 2. HAPPY PATH — Singleton via module-level object
// ============================================================

console.log('--- 2. Singleton pattern: one shared config object ---');

// In a real multi-file project this object would live in its own module
// file and be imported everywhere — the module loader's cache guarantees
// every importer gets the SAME object reference, which is what makes it
// a singleton with zero extra "Singleton class" ceremony.
const appConfig = (function createSingletonConfig() {
  let initialized = false;
  const settings = { theme: 'dark', apiBaseUrl: 'https://api.example.com' };

  function init(overrides = {}) {
    if (initialized) {
      console.log('Config already initialized — ignoring second init() call.');
      return settings;
    }
    Object.assign(settings, overrides);
    initialized = true;
    return settings;
  }

  function get() {
    return settings;
  }

  return { init, get };
})();

appConfig.init({ theme: 'light' });
appConfig.init({ theme: 'this-should-be-ignored' }); // second init is a no-op by design
console.log('Singleton config after two init calls:', appConfig.get()); // theme stays 'light'

// Simulating "two different parts of the app importing the same singleton":
function moduleA_readsConfig() {
  return appConfig.get().theme;
}
function moduleB_readsConfig() {
  return appConfig.get().theme;
}
console.log('Both "modules" see the identical singleton state:', moduleA_readsConfig() === moduleB_readsConfig()); // true

// The real-world leak this pattern can cause: mutating shared singleton
// state from one place silently affects every other place that reads it.
appConfig.get().theme = 'mutated-directly-bypassing-init';
console.log('Direct mutation leaks across every reader:', moduleA_readsConfig()); // 'mutated-directly-bypassing-init'
// Lesson: if a singleton's internals are mutable and reachable, ANY
// caller can corrupt global state for every other caller. Production
// fix: freeze the settings object after init, or only expose getters.

// ============================================================
// 3. HAPPY PATH — Factory pattern
// ============================================================

console.log('--- 3. Factory pattern: notification senders ---');

class EmailNotification {
  constructor(recipient) {
    this.recipient = recipient;
  }
  send(message) {
    return `Emailing "${message}" to ${this.recipient}`;
  }
}

class SmsNotification {
  constructor(recipient) {
    this.recipient = recipient;
  }
  send(message) {
    return `Texting "${message}" to ${this.recipient}`;
  }
}

class PushNotification {
  constructor(recipient) {
    this.recipient = recipient;
  }
  send(message) {
    return `Push-notifying "${message}" to device for ${this.recipient}`;
  }
}

// The factory is the ONLY place that knows about all three concrete
// classes — every caller just asks for a "type" and gets back an
// object satisfying the same `.send(message)` interface.
function createNotificationSender(type, recipient) {
  switch (type) {
    case 'email':
      return new EmailNotification(recipient);
    case 'sms':
      return new SmsNotification(recipient);
    case 'push':
      return new PushNotification(recipient);
    default:
      throw new Error(`Unknown notification type: ${type}`);
  }
}

const notifiers = [
  createNotificationSender('email', 'ada@example.com'),
  createNotificationSender('sms', '+1-555-0100'),
  createNotificationSender('push', 'device-42'),
];

// Calling code never references EmailNotification/SmsNotification/PushNotification
// directly — it only depends on the factory and the shared `.send()` shape.
for (const notifier of notifiers) {
  console.log(notifier.send('Your order has shipped'));
}

try {
  createNotificationSender('carrier-pigeon', 'n/a');
} catch (err) {
  console.log('Unsupported type correctly rejected:', err.message); // 'Unknown notification type: carrier-pigeon'
}

// ============================================================
// 4. HAPPY PATH — Observer / Pub-Sub via a small event bus
// ============================================================

console.log('--- 4. Observer/Pub-Sub pattern: event bus ---');

/**
 * A minimal event bus: a Map from event name -> Set of listener functions.
 * A Set (not an array) is used so the same listener function reference
 * can't accidentally get registered twice for the same event.
 */
function createEventBus() {
  const listenersByEvent = new Map();

  function on(eventName, listenerFn) {
    if (!listenersByEvent.has(eventName)) {
      listenersByEvent.set(eventName, new Set());
    }
    listenersByEvent.get(eventName).add(listenerFn);

    // Returning an "unsubscribe" closure is a common, ergonomic convention —
    // the caller doesn't need to remember the exact (eventName, listenerFn)
    // pair separately to clean up later.
    return function unsubscribe() {
      const set = listenersByEvent.get(eventName);
      if (set) {
        set.delete(listenerFn);
      }
    };
  }

  function off(eventName, listenerFn) {
    const set = listenersByEvent.get(eventName);
    if (set) {
      set.delete(listenerFn);
    }
  }

  function emit(eventName, payload) {
    const set = listenersByEvent.get(eventName);
    if (!set) return;
    // Listeners run SYNCHRONOUSLY, in registration (insertion) order —
    // Set preserves insertion order in JS, so this is deterministic.
    for (const listenerFn of set) {
      listenerFn(payload);
    }
  }

  return { on, off, emit };
}

const bus = createEventBus();

bus.on('greet', (name) => console.log(`Hello, ${name}!`));
bus.on('greet', (name) => console.log(`(logging) greet event fired for ${name}`));

bus.emit('greet', 'Ada');
// Expected, in this exact order:
// 'Hello, Ada!'
// '(logging) greet event fired for Ada'

const unsubscribeThird = bus.on('greet', (name) => console.log(`Third listener: ${name}`));
unsubscribeThird(); // remove it BEFORE the next emit

bus.emit('greet', 'Grace');
// Expected — third listener does NOT fire, because it was unsubscribed first:
// 'Hello, Grace!'
// '(logging) greet event fired for Grace'

// ============================================================
// 5. REAL-WORLD PATTERN — decoupling side effects with Pub-Sub
// ============================================================

console.log('--- 5. Decoupled side effects via emit ---');

const orderBus = createEventBus();

// Three completely independent listeners, none of which know about each other,
// all reacting to the same business event. This is the actual production
// pattern described in the README's talking points.
orderBus.on('order:placed', (order) => {
  console.log(`[email-service] Sending receipt for order #${order.id}`);
});
orderBus.on('order:placed', (order) => {
  console.log(`[inventory-service] Decrementing stock for order #${order.id}`);
});
orderBus.on('order:placed', (order) => {
  console.log(`[analytics-service] Logging order #${order.id} for metrics`);
});

function placeOrder(id, items) {
  // The checkout function's ONLY job is to build the order and announce it —
  // it has zero knowledge of email/inventory/analytics concerns.
  const order = { id, items, placedAt: 'FIXED_TIMESTAMP_FOR_DEMO' };
  orderBus.emit('order:placed', order);
  return order;
}

placeOrder(1001, ['widget', 'gadget']);
